// Steps for fetching wine region features from WFS:
// 1. Connect to the WFS service using its base URL.
// 2. Request the specific layer (dlm1000:objart_43001_f) in GeoJSON format.
// 3. Parse the GeoJSON response.
// 4. Filter features where properties.veg === "1040".
// 5. Return only the relevant features.

// Import the axios library for making HTTP requests
import axios from 'axios';

// WFS service base URL
const WFS_URL = 'https://sgx.geodatenzentrum.de/wfs_dlm1000';
// Layer name containing wine region features
const LAYER_NAME = 'dlm1000:objart_43001_f';

/**
 * Fetches wine region features from the WFS service.
 * Filters for features where veg = "1040" (wine regions).
 * Optionally filters for a specific region name ("nam" property).
 *
 * @param regionName Optional. If provided, only features with properties.nam === regionName will be returned.
 * @returns Array of filtered GeoJSON features.
 */
export async function fetchWineRegionsVeg1040(regionName?: string): Promise<any[]> {
  // Build the WFS GetFeature request parameters
  const params = {
    service: 'WFS', // Web Feature Service
    version: '1.1.0', // WFS version
    request: 'GetFeature', // Request type
    typename: LAYER_NAME, // Layer to query
    outputFormat: 'application/json' // Request GeoJSON format
  };

  // Construct the full request URL
  const url = `${WFS_URL}?${new URLSearchParams(params).toString()}`;

  // Make the HTTP GET request to the WFS service
  const response = await axios.get(url);
  // Parse the GeoJSON response
  const geojson = response.data;

  // Filter features for wine regions (veg = "1040")
  let filteredFeatures = geojson.features.filter(
    (feature: any) => feature.properties?.veg === "1040"
  );

  // If a region name is provided, filter further by "nam"
  if (regionName) {
    filteredFeatures = filteredFeatures.filter(
      (feature: any) => feature.properties?.nam === regionName
    );
  }

  // Return the filtered features
  return filteredFeatures;
}

// Usage example (uncomment to test):
// fetchWineRegionsVeg1040('Württemberg').then(features => {
//   console.log(features);
// });