// Who GloryMap says it is on every outbound request, and which Wikidata endpoint it asks
// (#85). Seventeen call sites wrote their own User-Agent in four versions and as many
// formats, and five modules declared the SPARQL endpoint.
//
// Two identities, one version. Wikimedia's policy wants a reachable contact and 403s a
// placeholder, so the calls that already carried the owner's address keep it
// (CONTACT_USER_AGENT); every other service is told the site, and the address goes no
// further than it already went.

const PRODUCT = "GloryMap/1.1";
const SITE = "https://glory-map.vercel.app/";

export const USER_AGENT = `${PRODUCT} (${SITE})`;
export const CONTACT_USER_AGENT = `${PRODUCT} (${SITE}; nakonechnyi.n@gmail.com)`;

export const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
