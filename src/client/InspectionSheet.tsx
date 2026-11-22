import type { PlayerView, Play } from "../protocol/messages.ts";
import { inspectionFacts, type Inspection } from "./inspection.ts";
import { Inspect } from "./PlayInteractions.tsx";
import PlayerSheet from "./PlayerSheet.tsx";

export default function InspectionSheet({
  inspection,
  view,
  selected,
  locked,
  available,
  onClose,
}: {
  inspection: Inspection;
  view: PlayerView | null;
  selected: string | null;
  locked: boolean;
  available: readonly Play[];
  onClose: (cancelSelection?: boolean) => void;
}) {
  const facts = inspectionFacts(inspection, view, selected, locked, available);
  return (
    <Inspect name={facts.name} onClose={onClose}>
      {facts.kind === "card" ? (
        <>
          <p>{facts.stats}</p>
          <p>{facts.ability}</p>
          {facts.showLaneHint && <p>Choose a lane to play this card.</p>}
        </>
      ) : facts.kind === "lane" ? (
        <>
          <p>{facts.label}</p>
          <p>{facts.text}</p>
        </>
      ) : view ? (
        // Switching sides by keyboard resets the open zone.
        <PlayerSheet key={facts.side} view={view} side={facts.side} />
      ) : null}
    </Inspect>
  );
}
