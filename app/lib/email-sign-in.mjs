// Sign-in by email link (#108): the second way in besides Google, and the one that needs no
// OAuth client of its own. Supabase sends the link; this module only decides what counts as
// an address worth sending to and what to tell the reader afterwards.

// Loose on purpose. The inbox is the real check: a typo the pattern lets through simply
// never receives the link, while a strict pattern would turn away real addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function signInEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

// The sentence under the form once Supabase has answered.
export function emailLinkMessage(email, error) {
  if (!error) return `Check your inbox: a sign-in link is on its way to ${email}.`;
  // Supabase allows a few links per address per hour, and says so with a 429.
  if (error.status === 429 || /rate limit/i.test(error.message ?? "")) {
    return "Too many links were asked for this address. Wait a few minutes and try again.";
  }
  return "The link could not be sent. Please try again.";
}
