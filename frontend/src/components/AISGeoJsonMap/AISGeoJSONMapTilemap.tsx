/**
 * Helpers that maps OBC theme names to `CartoDB` tilemap themes.
 *
 * More info on CartoDB tilemaps here: https://carto.com/help/building-maps/basemap-list/
 * For more free tilemap options, see https://github.com/alexurquhart/free-tiles/blob/master/tiles.json
 *
 * @returns getTileMapURL - a function that takes an OBC theme name and returns the corresponding CartoDB tilemap URL.
 *
 * */
const themeToTilemap: Record<string, string> = {
  night: "dark_all",
  dusk: "dark_all",
  day: "light_all",
  bright: "light_all",
};

function getTilemapURL(theme: string): string {
  return `https://{s}.basemaps.cartocdn.com/${
    themeToTilemap[theme] ?? "light_all"
  }/{z}/{x}/{y}{r}.png`;
}

export default getTilemapURL;
