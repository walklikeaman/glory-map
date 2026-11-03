"""OpenRouter backend for ScraperAI.

ScraperAI ships exactly two language-model classes, ``JsonOpenAI`` and
``VisionOpenAI`` (``scraperai/lm/openai.py``), and both are thin wrappers over
langchain's ``ChatOpenAI``. ``ChatOpenAI`` speaks the OpenAI wire format against
whatever ``openai_api_base`` it is handed, so moving ScraperAI off paid OpenAI
is a base-URL swap rather than a rewrite of the parsers.

Two things still have to change, which is why these are separate classes
instead of ``JsonOpenAI(..., openai_api_base=...)``:

1. ``JsonOpenAI`` wraps every call in ``get_openai_callback()``, which prices
   tokens from a hardcoded OpenAI price table. Through OpenRouter that table
   is wrong for every model, so it reports $0.000 and looks like a bug. We read
   usage off the response instead and leave pricing to the OpenRouter dashboard.
2. Models other than OpenAI's routinely return JSON wrapped in a ``` fence even
   under ``response_format=json_object``. ``json.loads`` on that raises, and the
   failure surfaces deep inside a parser. We strip the fence first.

Model choice matters: the parsers ask for JSON, so the model must advertise
``response_format`` support. Verify a candidate before switching to it::

    curl -s https://openrouter.ai/api/v1/models \\
      | jq '.data[] | select(.id=="MODEL") | .supported_parameters'
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Optional

from langchain_core.messages import BaseMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from scraperai.lm.base import BaseJsonLM, BaseVision, _Dict, _DictOrPydanticClass

logger = logging.getLogger('scraperai.openrouter')

OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

# Free tier, 262k context, supports both response_format and image input, so it
# covers the JSON parsers and the vision page-type classifier with one model.
# Kept in sync with OPENROUTER_MODEL in .env.example.
DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free'

# OpenRouter uses these for attribution on its model-usage leaderboards.
ATTRIBUTION_HEADERS = {
    'HTTP-Referer': 'https://github.com/walklikeaman/glory-map',
    'X-Title': 'GloryMap',
}

_FENCE_RE = re.compile(r'^\s*```(?:json)?\s*(.*?)\s*```\s*$', re.DOTALL)


class MissingApiKey(RuntimeError):
    pass


def resolve_api_key(explicit: Optional[str] = None) -> str:
    key = explicit or os.getenv('OPENROUTER_API_KEY')
    if not key:
        raise MissingApiKey(
            'OPENROUTER_API_KEY is not set. Get a key at '
            'https://openrouter.ai/settings/keys and export it, or put it in '
            'the repo .env (which is gitignored).'
        )
    return key


def resolve_model(explicit: Optional[str] = None) -> str:
    return explicit or os.getenv('OPENROUTER_MODEL') or DEFAULT_MODEL


def loads_lenient(text: str) -> _Dict:
    """json.loads, but tolerant of a markdown fence around the object."""
    match = _FENCE_RE.match(text)
    if match:
        text = match.group(1)
    return json.loads(text)


def _build_chat(api_key: str, model_name: str, model_kwargs: dict | None, **kwargs) -> ChatOpenAI:
    # langchain-openai 0.1.7 names this field openai_api_base; `base_url` is not
    # accepted on this version, so do not "modernise" it without bumping the pin.
    return ChatOpenAI(
        model=model_name,
        openai_api_key=api_key,
        openai_api_base=OPENROUTER_BASE_URL,
        default_headers=ATTRIBUTION_HEADERS,
        model_kwargs=model_kwargs or {},
        max_retries=3,
        **kwargs,
    )


class _UsageMixin:
    """Token accounting that does not assume OpenAI's price list."""

    def __init__(self):
        self._total_tokens = 0

    @property
    def total_tokens(self) -> int:
        return self._total_tokens

    @property
    def total_cost(self) -> float:
        # ScraperAI's ParserAI reads .total_cost off the model. OpenRouter bills
        # per model at rates we do not have locally, so report 0.0 and point at
        # total_tokens instead of inventing a number.
        return 0.0

    def _record(self, response) -> None:
        usage = (getattr(response, 'response_metadata', None) or {}).get('token_usage') or {}
        self._total_tokens += usage.get('total_tokens', 0)
        logger.info('OpenRouter tokens this call: %s (session total %s)',
                    usage.get('total_tokens', 0), self._total_tokens)


class JsonOpenRouter(_UsageMixin, BaseJsonLM):
    """Drop-in replacement for scraperai.lm.JsonOpenAI, routed via OpenRouter."""

    def __init__(self,
                 api_key: str = None,
                 model_name: str = None,
                 schema: Optional[_DictOrPydanticClass] = None,
                 **kwargs):
        _UsageMixin.__init__(self)
        self.model_name = resolve_model(model_name)
        self.chat = _build_chat(
            resolve_api_key(api_key),
            self.model_name,
            {'response_format': {'type': 'json_object'}},
            **kwargs,
        )
        self.model_with_structure = None
        if schema:
            self.model_with_structure = self.chat.with_structured_output(schema, method='json_mode')

    def invoke(self, messages: list[BaseMessage]) -> _Dict:
        if self.model_with_structure:
            response = self.model_with_structure.invoke(messages)
            if isinstance(response, BaseModel):
                return response.model_dump()
            return response

        response = self.chat.invoke(messages)
        self._record(response)
        return loads_lenient(response.content)


class VisionOpenRouter(_UsageMixin, BaseVision):
    """Drop-in replacement for scraperai.lm.VisionOpenAI, routed via OpenRouter.

    Only needed for screenshot-based page-type detection, which requires a
    Selenium crawler. The MovieMaps pipeline sets the page type explicitly and
    never constructs this.
    """

    def __init__(self, api_key: str = None, model_name: str = None, **kwargs):
        _UsageMixin.__init__(self)
        self.model_name = resolve_model(model_name)
        self.chat = _build_chat(resolve_api_key(api_key), self.model_name, None, **kwargs)

    def invoke(self, messages: list[BaseMessage]) -> str:
        response = self.chat.invoke(messages)
        self._record(response)
        return response.content


def make_parser(model_name: str = None, api_key: str = None):
    """A ScraperAI ParserAI wired to OpenRouter instead of OpenAI.

    Both models are passed explicitly. Leaving either as None makes ParserAI
    fall back to its OpenAI classes with an ``openai_api_key`` of None, which
    fails at construction rather than at call time -- so the vision model is
    built even though this pipeline never takes a screenshot.
    """
    from scraperai import ParserAI

    return ParserAI(
        json_lm_model=JsonOpenRouter(api_key=api_key, model_name=model_name, temperature=0),
        vision_model=VisionOpenRouter(api_key=api_key, model_name=model_name, temperature=0),
    )
