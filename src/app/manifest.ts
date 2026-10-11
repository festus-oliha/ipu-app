import type { MetadataRoute } from "next";

/** Lets members add the app to their phone's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Iyobor Progressive Union",
    short_name: "IPU",
    description: "Contributions, loans and statements for IPU members.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf8f1",
    theme_color: "#1e4d3a",
  };
}
