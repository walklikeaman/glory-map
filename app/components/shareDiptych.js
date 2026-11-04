"use client";

import { coverCrop, diptychFileName, diptychLayout, diptychText } from "../lib/diptych.mjs";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // The film frame comes from TMDB or a signed storage URL; both send CORS headers, and
    // without this the canvas is tainted and cannot be exported.
    if (!src.startsWith("blob:") && !src.startsWith("data:")) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("An image could not be loaded."));
    image.src = src;
  });
}

function drawCover(context, image, box) {
  const crop = coverCrop(image.naturalWidth, image.naturalHeight, box.width, box.height);
  if (!crop) return;
  context.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, box.x, box.y, box.width, box.height);
}

function drawTag(context, label, x, y) {
  context.font = "700 22px system-ui, -apple-system, Segoe UI, sans-serif";
  const width = context.measureText(label).width + 28;
  context.fillStyle = "rgba(0, 0, 0, 0.62)";
  context.beginPath();
  if (context.roundRect) context.roundRect(x, y, width, 38, 19);
  else context.rect(x, y, width, 38);
  context.fill();
  context.fillStyle = "#ffffff";
  context.fillText(label, x + 14, y + 27);
}

// Draw the card and return it as a JPEG blob.
// The largest font, from 34 px down, at which the title fits beside the wordmark.
function fitTitle(context, title, maxWidth) {
  for (let size = 34; size >= 20; size -= 2) {
    context.font = `800 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
    if (context.measureText(title).width <= maxWidth) return title;
  }
  // Still too long at 20 px: cut whole characters (never half a surrogate pair).
  const chars = Array.from(title);
  while (chars.length > 1 && context.measureText(`${chars.join("")}…`).width > maxWidth) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

export async function composeDiptych({ thenSrc, nowSrc, film, place, referenceLabel, kind }) {
  const [thenImage, nowImage] = await Promise.all([loadImage(thenSrc), loadImage(nowSrc)]);
  const layout = diptychLayout();
  const text = diptychText({ film, place, referenceLabel, kind, thenSrc });
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");

  context.fillStyle = "#101212";
  context.fillRect(0, 0, layout.width, layout.height);
  drawCover(context, thenImage, layout.then);
  drawCover(context, nowImage, layout.now);
  drawTag(context, text.thenTag, layout.then.x + 18, 18);
  drawTag(context, text.nowTag, layout.now.x + 18, 18);

  const { footer } = layout;
  context.fillStyle = "#f7b733";
  // 28 px margin on the left, and room for the wordmark (about 110 px) on the right.
  context.fillText(fitTitle(context, text.title, footer.width - 28 - 180), footer.x + 28, footer.y + 52);
  context.fillStyle = "rgba(255, 255, 255, 0.72)";
  context.font = "400 20px system-ui, -apple-system, Segoe UI, sans-serif";
  context.fillText(text.credit, footer.x + 28, footer.y + 90);
  context.textAlign = "right";
  context.fillStyle = "#ffffff";
  context.font = "800 24px system-ui, -apple-system, Segoe UI, sans-serif";
  context.fillText("GloryMap", footer.width - 28, footer.y + 52);

  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("The card could not be made."))), "image/jpeg", 0.88);
    } catch {
      reject(new Error("The film frame does not allow copying, so the card could not be made."));
    }
  });
  return { blob, text, fileName: diptychFileName({ film, place }) };
}

// The phone's share sheet when it takes files; otherwise a download. Returns what happened.
// Call it straight from the click with a card made beforehand: a share sheet needs the
// click's user activation, which an image load or two can use up (iOS refuses then).
export async function shareOrDownload({ blob, text, fileName, url }) {
  const file = new File([blob], fileName, { type: "image/jpeg" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: text.title, text: text.shareText, url });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      // A share sheet that fails for another reason still leaves the download.
    }
  }
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return "downloaded";
}
