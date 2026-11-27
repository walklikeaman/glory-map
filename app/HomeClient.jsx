"use client";

import dynamic from "next/dynamic";

const SceneMapApp = dynamic(() => import("./components/SceneMapApp"), {
  ssr: false,
  loading: () => (
    <main className="boot-screen">
      <div className="boot-mark" />
      <p>Loading the London map...</p>
    </main>
  ),
});

export default function HomeClient() {
  return <SceneMapApp />;
}
