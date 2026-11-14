import manifest from "../../content/art/manifest.json" with { type: "json" };

export default function Credits() {
  return (
    <section aria-label="Credits" className="credits">
      <h2>Credits</h2>
      {manifest.map((entry) => (
        <article key={entry.cardId}>
          <h3>{entry.cardName}</h3>
          <img
            src={
              new URL(`../../content/art/${entry.file}`, import.meta.url).href
            }
            alt={`Art for ${entry.cardName}`}
            width="120"
          />
          <p>{entry.title}</p>
          <p>{entry.author}</p>
          <p>{entry.attribution}</p>
          <p>{entry.modifications}</p>
          <p>
            <a href={entry.sourceUrl}>Source</a>
            {" · "}
            <a href={entry.licenseUrl}>{entry.license}</a>
          </p>
        </article>
      ))}
    </section>
  );
}
