const TYPE_PINS = new Map([
    ["Ancient Ruin", {
        url: "images/type_pins/ancient_ruin.png",
        size: [20, 19],
    }],
    ["Bounty", {
        url: "images/type_pins/bounty.png",
        size: [40, 40],
    }],
    ["Depresso Effigy", {
        url: "images/type_pins/depresso_effigy.png",
        size: [17, 24],
    }],
    ["Desert Egg", {
        url: "images/type_pins/desert_egg.png",
        size: [18, 20],
    }],
    ["Dungeon", {
        url: "images/type_pins/dungeon.png",
        size: [24, 18],
    }],
    ["Enemy Camp", {
        url: "images/type_pins/enemy_camp.png",
        size: [20, 20],
    }],
    ["Fast Travel", {
        url: "images/type_pins/fast_travel.png",
        size: [40, 40],
    }],
    ["Feybreak Egg", {
        url: "images/type_pins/feybreak_egg.png",
        size: [18, 20],
    }],
    ["Frozen Egg", {
        url: "images/type_pins/frozen_egg.png",
        size: [18, 20],
    }],
    ["Grass Egg", {
        url: "images/type_pins/grass_egg.png",
        size: [18, 20],
    }],
    ["Herbil Effigy", {
        url: "images/type_pins/herbil_effigy.png",
        size: [16, 20],
    }],
    ["Journals", {
        url: "images/type_pins/journals.png",
        size: [15, 16],
    }],
    ["Lamball Effigy", {
        url: "images/type_pins/lamball_effigy.png",
        size: [20, 20],
    }],
    ["Lifmunk Effigy", {
        url: "images/type_pins/lifmunk_effigy.png",
        size: [20, 18],
    }],
    ["Lunaris Effigy", {
        url: "images/type_pins/lunaris_effigy.png",
        size: [20, 19],
    }],
    ["Munchill Effigy", {
        url: "images/type_pins/munchill_effigy.png",
        size: [16, 20],
    }],
    ["Pengullet Effigy", {
        url: "images/type_pins/pengullet_effigy.png",
        size: [17, 20],
    }],
    ["Relaxaurus Effigy", {
        url: "images/type_pins/relaxaurus_effigy.png",
        size: [20, 20],
    }],
    ["Rooby Effigy", {
        url: "images/type_pins/rooby_effigy.png",
        size: [18, 24],
    }],
    ["Sakura Egg", {
        url: "images/type_pins/sakura_egg.png",
        size: [18, 20],
    }],
    ["Sunreach Egg", {
        url: "images/type_pins/sunreach_egg.png",
        size: [18, 20],
    }],
    ["Tanzee Effigy", {
        url: "images/type_pins/tanzee_effigy.png",
        size: [18, 20],
    }],
    ["Tower", {
        url: "images/type_pins/tower.png",
        size: [32, 32],
    }],
    ["Treasure Map", {
        url: "images/type_pins/treasure_map.png",
        size: [20, 20],
    }],
    ["Volcano Egg", {
        url: "images/type_pins/volcano_egg.png",
        size: [18, 20],
    }],
    ["Watchtower", {
        url: "images/type_pins/watchtower.png",
        size: [17, 20],
    }],
]);


/** Returns the shared custom pin for a POI type, when one exists. */
export function typePin(type_name)
{
    return TYPE_PINS.get(type_name);
}
