// Where a moderator checks readers' suggestions (#48). Not linked from the map and not
// indexed: the route behind it answers only a moderator's session.

import SuggestionReview from "../components/SuggestionReview.jsx";

export const metadata = {
  title: "Review suggestions · GloryMap",
  robots: { index: false, follow: false },
};

export default function ReviewPage() {
  return <SuggestionReview />;
}
