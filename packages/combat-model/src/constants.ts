/** The id the engine uses inside for an actor id of null, as the packets write it */
export const invalidTarget = 0xe0000000

/** The engine's own id of an actor id of the inputs */
export const actorId = (id: number | null): number => id ?? invalidTarget

/** The actor id of the outputs; 0 is no actor either */
export const outputId = (id: number): number | null => (id === 0 || id === invalidTarget ? null : id)
