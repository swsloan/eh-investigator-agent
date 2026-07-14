---
{
  "anchor": "geoip",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [],
  "methods": [
    "getCountry(ipaddr: IPAddress): Object",
    "continentName: String",
    "continentCode: Number",
    "countryName: String",
    "countryCode: String",
    "getPreciseLocation(ipaddr: IPAddress): Object",
    "region: String",
    "city: String",
    "latitude: Number",
    "longitude: Number",
    "radius: Number"
  ],
  "name": "GeoIP",
  "properties": [],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### GeoIP

The `GeoIP` class enables you to retrieve the approximate country-level or city-level location of a specific address.

#### Methods

Values returned by GeoIP methods are obtained from the [MaxMind GeoLite2 country or city databases](https://dev.maxmind.com/geoip/docs/databases/city-and-country/) unless configured otherwise by the [Geomap Data Source](https://docs.extrahop.com/26.2/eh-admin-ui-guide/#geomap-data-source) settings in the Administration settings.

From the Geomap Data Source settings, you can upload custom databases and specify which database to reference by default for city or country lookups.

We recommend uploading only a custom city-level database if you intend to call both `GeoIP.getCountry()` and `GeoIP.getPreciseLocation()` methods in triggers. If both types of custom databases are uploaded, the ExtraHop system retrieves values for both methods from the city-level database and ignores the country-level database, which is considered to be a subset of the city-level database.

- **getCountry(ipaddr: IPAddress): Object**: Returns country-level detail for the specified

[IPAddress](#ipaddress)

in an object that contains the following fields:

- **continentName: String**: The name of the continent, such as

`Europe`

, that is associated with the country from which the specified IP address originates. The value is the same as the

`continentName`

field returned by the

`getPreciseLocation()`

method.
- **continentCode: Number**: The code of the continent, such as

`EU`

, that is associated with the value of the

`countryCode`

field, according to ISO 3166. The value is the same as the

`continentCode`

field returned by the

`getPreciseLocation()`

method.
- **countryName: String**: The name of the country from which the specified IP address originates, such as

`United States`

. The value is the same as the

`countryName`

field returned by the

`getPreciseLocation()`

method.
- **countryCode: String**: The code associated with the country, according to ISO 3166, such as

`US`

. The value is the same as the

`countryCode`

field returned by the

`getPreciseLocation()`

method.

Returns `null` in any field for which no data is available, or returns a `null` object if all field data is unavailable.

| Note: | The `getCountry()` method requires 20 MB of total RAM on the ExtraHop system, which might affect system performance. The first time this method is called in any trigger, the ExtraHop system reserves the required amount of RAM unless the `getPreciseLocation()` method has already been called. The `getPreciseLocation()` method requires 100 MB of RAM, so adequate RAM will already be available to call the `getCountry()` method. The required amount of RAM is not per trigger or per method call; the ExtraHop system only reserves the required amount of RAM one time. |
| --- | --- |

In the following code example, the `getCountry()` method is called on each specified event and retrieves rough location data for each client IP address:

```javascript
// ignore if the IP address is non-routable
if (Flow.client.ipaddr.isRFC1918) return;
var results=GeoIP.getCountry(Flow.client.ipaddr);
if (results) {
    countryCode=results.countryCode;
    // log the 2-letter country code of each IP address 
    debug ("Country Code is " + results.countryCode);
}
```
- **getPreciseLocation(ipaddr: IPAddress): Object**: Returns city-level detail for the specified

[IPAddress](#ipaddress)

in an object that contains the following fields:

- **continentName: String**: The name of the continent, such as

`Europe`

, that is associated with the country from which the specified IP address originates. The value is the same as the

`continentName`

field returned by the

`getCountry()`

method.
- **continentCode: Number**: The code of the continent, such as

`EU`

, that is associated with the value of the

`countryCode`

field, according to ISO 3166. The value is the same as the

`continentCode`

field returned by the

`getCountry()`

method.
- **countryName: String**: The name of the country from which the specified IP address originates, such as

`United States`

. The value is the same as the

`countryName`

field returned by the

`getCountry()`

method.
- **countryCode: String**: The code associated with the country, according to ISO 3166, such as

`US`

. The value is the same as the

`countryCode`

field returned by the

`getCountry()`

method.
- **region: String**: The region, such as a state or province, such as

`Washington`

.
- **city: String**: The city from which the IP address originates, such as

`Seattle`

.
- **latitude: Number**: The latitude of the IP address location.
- **longitude: Number**: The longitude of the of the IP address location.
- **radius: Number**: The radius, expressed in kilometers, around the longitude and latitude coordinates of the IP address location.

Returns `null` in any field for which no data is available, or returns a `null` object if all field data is unavailable.

| Note: | The `getPreciseLocation()` method requires 100 MB of total RAM on the ExtraHop system, which might affect system performance. The first time this method is called in any trigger, the ExtraHop system reserves the required amount of RAM unless the `getCountry()` method has already been called. The `getCountry()` method requires 20 MB of RAM, so the ExtraHop system reserves an additional 80 MB of RAM. The required amount of RAM is not per trigger or per method call; the ExtraHop system only reserves the required amount of RAM one time. |
| --- | --- |
