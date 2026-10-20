# Nearby Bites

**Find food near you that's open right now.**

Nearby Bites shows restaurants, fast food, cafés, bakeries and dessert spots around you, with the places that are actually open at the top. Type an address or use your current location, filter by cuisine, and tap any spot for directions, a menu link, a phone number and its hours.

Can't decide? Hit **Pick for me** and it chooses a nearby spot for you.

**Live site:** `https://pxri-hub.github.io/nearby-bites/`

---

## Features

- **Two ways to start:** type an address (with suggestions as you type) or use your current location. The browser asks your permission first.
- **Open now:** every spot shows "Open till 11 PM", "Closing in 20 min", "Open 24 hours" or "Closed", worked out from its listed hours, including places open past midnight.
- **Distance options:** 1 km, 2 km or 5 km, switching instantly, plus a **Further** section that looks out to 10 km.
- **Filter menu:** filter by type (restaurants, fast food, cafés, bakeries, desserts) and by cuisine. The cuisine list is built from what's actually nearby, with counts.
- **Details card:** directions, menu (when listed), call, website and a link to the full Google Maps listing, plus address, hours and extras like takeout, delivery, vegan options and wheelchair access. Close it with the X, a click outside or Esc, and you're right where you left off in the list.
- **Pick for me:** a random open spot from the closest matches, with a **Pick again** button.
- **Favourites:** heart any spot to save it, then filter to show only favourites.
- **List or map view:** see everything on a map, colour-coded by open status.
- **Light and dark mode:** follows your device setting, or switch with the moon button.
- **Cookie choice:** a simple Accept or Decline banner. The site works fully either way.
- **Works anywhere:** not just Toronto. Coverage is best in cities and thinner in small towns.

## Built with

- Plain **HTML, CSS and JavaScript** in a single file, with no frameworks, build step or server.
- **[OpenStreetMap](https://www.openstreetmap.org)** data for places and hours, fetched through the free [Overpass API](https://overpass-api.de).
- **[Nominatim](https://nominatim.org)** and **[Photon](https://photon.komoot.io)** for address search and suggestions.
- **[Leaflet](https://leafletjs.com)** for the map.
- **[opening_hours.js](https://github.com/opening-hours/opening_hours.js)** for reading opening hours, including holidays, with a built-in fallback reader.

No API keys or accounts are needed.

## Run it on your computer

Location and data requests only work from a web address, so don't just double-click the file.

1. Download or clone this repository.
2. Open the folder in **VS Code**.
3. Install the **Live Server** extension (by Ritwick Dey).
4. Right-click `index.html` and choose **Open with Live Server**.
5. It opens in your browser at an address like `http://127.0.0.1:5500/index.html`.

## Pull it up online with GitHub Pages

`https://pxri-hub.github.io/nearby-bites/`

GitHub Pages serves the site over HTTPS, which the location feature needs.

## How it works

1. You type an address or share your location, and the site gets a map point.
2. It asks OpenStreetMap for every food spot within 5 km, in one request.
3. On your device, it checks each spot's listed hours against the current time.
4. It filters and sorts the results, closest first, and refreshes the open status every minute.

All of this runs in your browser. There's no backend and no database.

## Privacy

- Your location is only used to find nearby places. It's sent to the map data service as part of that search and isn't stored anywhere.
- There are no ads, analytics or tracking.
- If you accept cookies, your favourites, distance and theme are saved in your own browser. If you decline, nothing is saved.

## Known limits

- **Hours are community-edited,** so a small shop's hours can be out of date. Use the Google info button to double-check before heading out.
- **The free map servers can be slow or busy** at peak times. The site retries and switches servers on its own, but the first load can take a few seconds.
- **Menus only show when a place has listed a menu link.**

## Roadmap

- [ ] Better menu display inside the details card
- [ ] Search by dish or keyword (for example, "ramen")
- [ ] Price level filter
- [ ] Share a spot with a friend
- [ ] Log in page
- [ ] Add pictures with the food places
- [ ] Save data under login and use data to add more features

## Credits

Place data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License.
