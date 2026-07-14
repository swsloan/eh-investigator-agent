---
{
  "anchor": "buffer",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [
    "Example: Parse NTP with universal payload analysis",
    "Example: Parse syslog over TCP with universal payload analysis"
  ],
  "methods": [
    "Buffer(string: String | format: String)",
    "string: String",
    "format: String",
    "decode(type: String): String",
    "equals(buffer: Buffer): Boolean",
    "slice(start: Number, end: Number): Buffer",
    "start: Number",
    "end: Number",
    "toString(format: String): String",
    "unpack(format: String, offset: Number): Array"
  ],
  "name": "Buffer",
  "properties": [
    "length: Number"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Buffer

The `Buffer` class provides access to binary data.

A buffer is an object with the characteristics of an array. Each element in the array is a number between 0 and 255, representing one byte. Each buffer object has a length property (the number of items in an array) and a square bracket operator.

Encrypted payload is not decrypted for TCP and UDP payload analysis.

`UDP_PAYLOAD` requires a matching string but `TCP_PAYLOAD` does not. If you do not specify a matching string for `TCP_PAYLOAD`, the trigger runs one time after the first N bytes of payload.

#### Methods

- **Buffer(string: String | format: String)**: Constructor for the Buffer class that decodes an encoded string into a Buffer object. The following parameters are required:

- **string: String**: The encoded string.
- **format: String**: The format that the string argument is encoded with. The following encoding formats are valid:

- `base64`
- `base64url`

#### Instance methods

- **decode(type: String): String**: Interprets the contents of the buffer and returns a string with one of the following options:

- `utf-8`
- `utf-16`
- `ucs2`
- `hex`
- **equals(buffer: Buffer): Boolean**: Performs an equality test between Buffer objects, where

`buffer`

is the object to be compared against.
- **slice(start: Number, end: Number): Buffer**: Returns the specified bytes in a buffer as a new buffer. Bytes are selected starting at the given start argument and ending at (but not including) the end argument.

- **start: Number**: Integer that specifies where to start the selection. Specify negative numbers to select from the end of a buffer. This is zero-based.
- **end: Number**: Optional integer that specifies where to end the selection. If omitted, all elements from the start position and to the end of the buffer will be selected. Specify negative numbers to select from the end of a buffer. This is zero-based.
- **toString(format: String): String**: Converts the buffer to a string. The following parameter is optional:

- **format: String**: The format to encode the string with. If no encoding is specified, the string is unencoded. The following encoding formats are valid:

- `base64`
- `base64url`
- `hex`
- **unpack(format: String, offset: Number): Array**: Processes binary or fixed-width data from any buffer object, such as one returned by

`HTTP.payload`

,

`Flow.client.payload`

, or

`Flow.sender.payload`

, according to the given format string and, optionally, at the specified offset.

Returns a JavaScript array that contains one or more unpacked fields and contains the absolute payload byte position +1 of the last byte in the unpacked object. The bytes value can be specified as the offset in further calls to unpack a buffer.

| Note: | The `buffer.unpack` method interprets bytes in big-endian order by default. To interpret bytes in little-endian order, prefix the format string with a less than sign (`<`). The format does not have to consume the entire buffer. Null bytes are not included in unpacked strings. For example: `buf.unpack('4s')[0] - > 'example'`. The z format character represents variable-length, null-terminated strings. If the last field is z, the string is produced whether or not the null character is present. An exception is throw when all of the fields cannot be unpacked because the buffer does not contain enough data. |
| --- | --- |

The table below displays supported buffer string formats:

| Format | C type | JavaScript type | Standard size |
| --- | --- | --- | --- |
| `x` | `pad type` | no value |  |
| `A` | `struct in6_addr` | `IPAddress` | `16` |
| `a` | `struct in_addr` | `IPAddress` | `4` |
| `b` | `signed char` | `string of length 1` | `1` |
| `B` | `unsigned char` | `number` | `1` |
| `?` | `_Bool` | `boolean` | `1` |
| `H` | unsigned short | `number` | `2` |
| `h` | `short` | `number` | `2` |
| `i` | `int` | `number` | `4` |
| `I` | `unsigned int` | `number` | `4` |
| `l` | `long` | `number` | `4` |
| `L` | `unsigned long` | `number` | `4` |
| `q` | `long long` | `number` | `8` |
| `Q` | `unsigned long long` | `number` | `8` |
| `f` | `number` | `number` | `4` |
| `d` | `double` | `number` | `4` |
| `s` | `char[]` | `string` |  |
| `z` | `char[]` | `string` |  |

#### Instance Properties

- **length: Number**: The number of bytes in the buffer.

#### Trigger Examples

- [Example: Parse NTP with universal payload analysis](#example-parse-ntp-with-universal-payload-analysis)
- [Example: Parse syslog over TCP with universal payload analysis](#example-parse-syslog-over-tcp-with-universal-payload-analysis)
