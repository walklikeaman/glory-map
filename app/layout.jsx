import "./globals.css";

import OfflineReady from "./components/OfflineReady.jsx";

export const metadata = {
  title: "GloryMap",
  description: "Walk through places from your favourite films, series, and books",
  // "Add to Home Screen" on an iPhone (#114): Safari ignores the manifest's SVG icon and
  // would take a screenshot of the page instead, so `app/apple-icon.png` (180 px) is the
  // icon, and these tags open it without Safari's bars, under a dark status bar.
  appleWebApp: { capable: true, title: "GloryMap", statusBarStyle: "black-translucent" },
};

// viewport-fit=cover is what makes env(safe-area-inset-*) resolve to anything on a
// notched iPhone; without it the bottom sheet sits under the home indicator and the
// top panel under the Dynamic Island. maximumScale is deliberately left alone —
// blocking zoom would make the map unusable for anyone who needs to magnify it.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080909",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <OfflineReady />
      </body>
    </html>
  );
}
