export function Attribution({ provider, sources }: { provider: string; sources: string[] }) {
  const credits = [...new Set(sources.filter(Boolean))].join(" · ");
  if (provider !== "geoapify") return <>{credits}</>;
  return <>
    Powered by <a href="https://www.geoapify.com/">Geoapify</a>
    {" · "}<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>
    {credits && credits !== "Geoapify" ? ` · ${credits}` : ""}
  </>;
}
