/**
 * SCRBRD — a weather HINT for a practice match, and where it will come from.
 *
 * The record of a practice match's weather is the SCORER'S OWN OBSERVATION,
 * from the quick buttons (lib/practice.js WEATHER_CONDITIONS). A hint is
 * something shown beside those buttons, never stored and never entered for the
 * scorer: "Weather by Google", as a suggestion to look up at the sky.
 *
 * Today there is none. getWeatherHint returns null, and no weather service is
 * called from the app.
 *
 * LATER (a separate task, for the Opus tier): this function asks OUR API,
 * which calls Google's Weather API with a key that lives on the server only
 * and never in this bundle, and answers with the hint below. Only the
 * coordinates, rounded, may leave the phone for it — never a name, a team or
 * anything of the match — and the screen must show "Weather by Google" with
 * the hint (the provider's attribution requirement). The caller already
 * awaits the result, so that version may return a Promise.
 *
 * @typedef {object} WeatherHint
 * @property {string} condition        one of lib/practice.js WEATHER_CONDITIONS ids, if it maps
 * @property {number | null} [temp_c]
 * @property {number | null} [wind_kph]
 * @property {string} attribution      "Weather by Google"
 */

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {WeatherHint | null | Promise<WeatherHint | null>}
 */
export function getWeatherHint(_lat, _lon) {
  return null;
}
