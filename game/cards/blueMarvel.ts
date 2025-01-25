import { Card } from "../cards/card.ts";
import { GameState } from "../gameState.ts";


const blueMarvel = new Card(
    "blue-marvel",
    "Blue Marvel",
    5,
    3,
    ["Ongoing"],
    (gameState: GameState, sourceCard) => {
        const effect = new Effect(
            sourceCard,
            (targetCard) => {
                if (targetCard.ownerId === sourceCard.ownerId) {
                    targetCard.power += 1; // Apply +1 power to allied cards
                }
            },
            (targetCard) => {
                if (targetCard.ownerId === sourceCard.ownerId) {
                    targetCard.power -= 1; // Revert +1 power when effect is removed
                }
            }
        );

        // Add the effect to all zones controlled by the player
        const playerZones = gameState.getZonesByPlayer(sourceCard.ownerId);
        playerZones.forEach(zone => {
            zone.addOngoingEffect(effect, gameState);
        });
    }
);