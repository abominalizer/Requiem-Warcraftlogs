// Defensives checked on every death ("did they have one ready and not press it?").
//
// Spells are matched by NAME (spell IDs change between patches; names rarely do).
// `cd` is the base cooldown in seconds. Talents can shorten some of them; the check only matters
// within one pull, so approximate values are fine. Edit freely.
//
// A spell only counts as "known" for a player if they cast it at least once that raid night,
// so talent choices and racials are handled automatically.

export interface DefensiveSpell {
  name: string;
  cd: number;
}

/** Personal defensives by class (WCL class names). */
export const CLASS_DEFENSIVES: Record<string, DefensiveSpell[]> = {
  DeathKnight: [
    { name: "Icebound Fortitude", cd: 180 },
    { name: "Anti-Magic Shell", cd: 60 },
    { name: "Lichborne", cd: 120 },
    { name: "Death Pact", cd: 120 },
    { name: "Vampiric Blood", cd: 90 },
  ],
  DemonHunter: [
    { name: "Blur", cd: 60 },
    { name: "Netherwalk", cd: 180 },
    { name: "Fiery Brand", cd: 60 },
  ],
  Druid: [
    { name: "Barkskin", cd: 60 },
    { name: "Survival Instincts", cd: 180 },
    { name: "Renewal", cd: 90 },
    { name: "Frenzied Regeneration", cd: 36 },
  ],
  Evoker: [
    { name: "Obsidian Scales", cd: 90 },
    { name: "Renewing Blaze", cd: 90 },
  ],
  Hunter: [
    { name: "Aspect of the Turtle", cd: 180 },
    { name: "Survival of the Fittest", cd: 120 },
    { name: "Exhilaration", cd: 120 },
    { name: "Fortitude of the Bear", cd: 120 },
  ],
  Mage: [
    { name: "Ice Block", cd: 240 },
    { name: "Ice Cold", cd: 240 },
    { name: "Greater Invisibility", cd: 120 },
    { name: "Mirror Image", cd: 120 },
    { name: "Alter Time", cd: 60 },
  ],
  Monk: [
    { name: "Fortifying Brew", cd: 360 },
    { name: "Diffuse Magic", cd: 90 },
    { name: "Dampen Harm", cd: 120 },
    { name: "Touch of Karma", cd: 90 },
  ],
  Paladin: [
    { name: "Divine Shield", cd: 300 },
    { name: "Divine Protection", cd: 60 },
    { name: "Shield of Vengeance", cd: 90 },
    { name: "Lay on Hands", cd: 600 },
    { name: "Ardent Defender", cd: 120 },
  ],
  Priest: [
    { name: "Desperate Prayer", cd: 90 },
    { name: "Dispersion", cd: 120 },
  ],
  Rogue: [
    { name: "Cloak of Shadows", cd: 120 },
    { name: "Evasion", cd: 120 },
    { name: "Feint", cd: 15 },
    { name: "Crimson Vial", cd: 30 },
  ],
  Shaman: [{ name: "Astral Shift", cd: 120 }],
  Warlock: [
    { name: "Unending Resolve", cd: 180 },
    { name: "Dark Pact", cd: 60 },
  ],
  Warrior: [
    { name: "Die by the Sword", cd: 120 },
    { name: "Enraged Regeneration", cd: 120 },
    { name: "Shield Wall", cd: 180 },
  ],
};

/**
 * Consumables. `match` finds every version by name.
 * - `oncePerPull`: used up when eaten (a Healthstone is gone until the next Soulwell visit).
 * - `group`: shares a cooldown with every spell matching it (all potions share one cooldown,
 *   so a DPS potion at the pull blocks the health potion).
 */
export const CONSUMABLES: { label: string; match: RegExp; cd: number; oncePerPull?: boolean; group?: RegExp }[] = [
  { label: "Healthstone", match: /^healthstone$/i, cd: 0, oncePerPull: true },
  { label: "Demonic Healthstone", match: /^demonic healthstone$/i, cd: 60 },
  { label: "Health Potion", match: /(health|healing) potion/i, cd: 300, group: /potion/i },
];

/** Defensives other players cast on someone (shown when received shortly before a death). */
export const EXTERNALS = [
  "Pain Suppression",
  "Guardian Spirit",
  "Ironbark",
  "Life Cocoon",
  "Blessing of Sacrifice",
  "Blessing of Protection",
  "Time Dilation",
];

/** Seconds before a death in which a defensive counts as "used for it". */
export const USED_WINDOW_S = 10;
