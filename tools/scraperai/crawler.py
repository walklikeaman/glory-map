"""A polite HTTP crawler for MovieMaps, usable as a ScraperAI BaseCrawler.

ScraperAI's own RequestsCrawler is a one-line ``requests.get`` with no user
agent, no delay, no retry and no cache. Against 6k+ MovieMaps pages that is
both rude and slow to iterate on, so this replaces it. Selenium is not needed:
MovieMaps renders everything server-side (a movie page is ~13 KB of HTML with
the locations already in it).

What MovieMaps allows, checked 2026-08-05:
    https://moviemaps.org/robots.txt -> User-agent: *  /  Disallow: /search
Only /search is off limits, and the site publishes sitemaps for movies,
episodes, collections, locations, cities and images. This crawler stays off
/search and identifies itself.
"""

from __future__ import annotations

import hashlib
import logging
import re
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests

from scraperai.crawlers.base import BaseCrawler
from scraperai.models import Pagination

logger = logging.getLogger('scraperai.moviemaps')

BASE = 'https://moviemaps.org'
USER_AGENT = (
    'GloryMapBot/0.1 (+https://github.com/walklikeaman/glory-map; '
    'contact via repo issues) python-requests'
)
CACHE_DIR = Path(__file__).parent / '.cache'


class Blocked(RuntimeError):
    pass


class MovieMapsCrawler(BaseCrawler):
    """Cached, rate-limited GET. Satisfies ScraperAI's BaseCrawler interface."""

    def __init__(self, delay: float = 0.7, cache_dir: Path = CACHE_DIR, use_cache: bool = True,
                 base: str = BASE, blocked_paths: tuple[str, ...] = ('/search',)):
        # `base` and `blocked_paths` exist so a second site can reuse the pacing,
        # caching and retry without inheriting MovieMaps' robots.txt. Each site
        # states its own disallow list; assuming one site's is another's is how a
        # crawler ends up somewhere it was asked not to go.
        self.base = base
        self.blocked_paths = blocked_paths
        self.delay = delay
        self.cache_dir = Path(cache_dir)
        self.use_cache = use_cache
        self.current_url: str | None = None
        self._page_source: str | None = None
        self._last_request_at = 0.0
        # fetch() is called from a thread pool by harvest.py; the pacing clock
        # is global so N workers still add up to one request every `delay`.
        self._pace_lock = threading.Lock()
        self.session = requests.Session()
        self.session.headers['User-Agent'] = USER_AGENT
        self.stats = {'fetched': 0, 'cached': 0, 'failed': 0}
        if self.use_cache:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _cache_path(self, url: str) -> Path:
        return self.cache_dir / f'{hashlib.sha1(url.encode()).hexdigest()}.html'

    def _pace(self) -> None:
        """Block until this thread may issue the next request."""
        with self._pace_lock:
            wait = self.delay - (time.monotonic() - self._last_request_at)
            if wait > 0:
                time.sleep(wait)
            self._last_request_at = time.monotonic()

    def fetch(self, url: str, retries: int = 3) -> str:
        path = urlsplit(url).path
        for blocked in self.blocked_paths:
            if path.startswith(blocked):
                raise Blocked(f'robots.txt disallows {blocked}: {url}')

        cached = self._cache_path(url)
        if self.use_cache and cached.exists():
            self.stats['cached'] += 1
            return cached.read_text(encoding='utf-8')

        last_error: Exception | None = None
        for attempt in range(retries):
            self._pace()
            try:
                response = self.session.get(url, timeout=30)
            except requests.RequestException as exc:
                last_error = exc
            else:
                if response.status_code == 200:
                    # requests follows RFC 2616 and assumes ISO-8859-1 for
                    # text/* when the HTTP header names no charset. That is the
                    # wrong guess for any modern site: movie-locations.com
                    # declares UTF-8 in a <meta> tag and sends no charset
                    # header, so 519 of its 1,870 pages decoded into mojibake —
                    # "Leon" arriving as "LA<C3>on" and heading for the catalogue.
                    # Trust the header when it says something, the document when
                    # it does not.
                    if 'charset=' not in response.headers.get('content-type', '').lower():
                        declared = re.search(rb'<meta[^>]+charset=["\']?([\w-]+)',
                                             response.content[:4096], re.I)
                        response.encoding = (declared.group(1).decode('ascii', 'ignore')
                                             if declared else response.apparent_encoding)
                    self.stats['fetched'] += 1
                    if self.use_cache:
                        cached.write_text(response.text, encoding='utf-8')
                    return response.text
                if response.status_code == 404:
                    raise FileNotFoundError(url)
                if response.status_code in (429, 503):
                    # Back off hard; the site is telling us to slow down.
                    time.sleep(5 * (attempt + 1))
                last_error = Blocked(f'HTTP {response.status_code} for {url}')
            time.sleep(1.5 * (attempt + 1))

        self.stats['failed'] += 1
        raise last_error or Blocked(url)

    # -- BaseCrawler ------------------------------------------------------
    def get(self, url: str) -> None:
        self.current_url = url
        self._page_source = self.fetch(url)

    @property
    def page_source(self) -> str:
        return self._page_source

    def switch_page(self, pagination: Pagination) -> bool:
        # MovieMaps detail pages carry their whole payload in one response.
        return False

    def get_screenshot_as_base64(self) -> str:
        raise NotImplementedError('MovieMaps is server-rendered; no screenshots needed')


def sitemap_urls(crawler: MovieMapsCrawler, name: str, index_url: str = None) -> list[str]:
    """Every <loc> in a MovieMaps sitemap, following its ?p= pages."""
    import re

    urls: list[str] = []
    index = crawler.fetch(index_url or f'{crawler.base}/sitemap.xml')
    pages = [loc for loc in re.findall(r'<loc>([^<]+)</loc>', index) if name in loc]
    if not pages:
        raise ValueError(f'no sitemap named {name!r}; index lists: {re.findall(r"sitemap-([a-z]+)", index)}')
    for page in pages:
        urls.extend(re.findall(r'<loc>([^<]+)</loc>', crawler.fetch(page)))
    return urls


def sitemap_entries(crawler: MovieMapsCrawler, name: str,
                    index_url: str = None) -> list[tuple[str, str | None]]:
    """(url, lastmod) for every entry, so a run can skip what has not moved.

    MovieMaps dates every sitemap entry -- most say 2021, a few say this year --
    and sitemap_urls threw that away. It is the only signal that lets a repeat
    run avoid fetching 18,048 pages to learn that 18,000 are unchanged.
    """
    import re

    entries: list[tuple[str, str | None]] = []
    index = crawler.fetch(index_url or f'{crawler.base}/sitemap.xml')
    pages = [loc for loc in re.findall(r'<loc>([^<]+)</loc>', index) if name in loc]
    if not pages:
        raise ValueError(f'no sitemap named {name!r}')
    for page in pages:
        for block in re.findall(r'<url>(.*?)</url>', crawler.fetch(page), re.S):
            loc = re.search(r'<loc>([^<]+)</loc>', block)
            if not loc:
                continue
            lastmod = re.search(r'<lastmod>([^<]+)</lastmod>', block)
            entries.append((loc.group(1), lastmod.group(1) if lastmod else None))
    return entries
