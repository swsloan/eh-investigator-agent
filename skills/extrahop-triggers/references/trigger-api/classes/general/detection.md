---
{
  "anchor": "detection",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [
    "DETECTION_UPDATE"
  ],
  "examples": [],
  "methods": [],
  "name": "Detection",
  "properties": [
    "applianceId: Number",
    "assignee: String",
    "categories: Array of Strings",
    "description: String",
    "endTime: Number",
    "id: Number",
    "isCustom: Boolean",
    "isEventCreate: Boolean",
    "mitreCategories: Array of Objects",
    "id",
    "name",
    "url",
    "participants: Array of Objects",
    "object: Object",
    "role: String",
    "properties: Object",
    "resolution: String",
    "riskScore: number | null",
    "startTime: Number",
    "status: String | null",
    "ticketId: String",
    "title: String",
    "type: String",
    "updateTime: Number"
  ],
  "section": "general-purpose-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Detection

The `Detection` class enables you to retrieve information about detections on the ExtraHop system.

| Note: | Machine learning detections require a [connection to ExtraHop Cloud Services](https://docs.extrahop.com/26.2/eh-cloud-services/#connect-to-extrahop-cloud-services). |
| --- | --- |

#### Events

- **DETECTION_UPDATE**: Runs when a detection is created or updated on the ExtraHop system.

| Tip: | Instead of writing a trigger to export detection data, we recommend that you [create a detection notification rule](https://docs.extrahop.com/26.2/detections-create-notification-rule). You can configure these rules to send JSON payloads with a webhook and avoid the complexity of writing a trigger. |
| --- | --- |

| Important: | This event runs for all detections, regardless of the module access granted to the user who creates the trigger. For example, triggers created by users with NPM module access run on `DETECTION_UPDATE` events for both security and performance detections. |
| --- | --- |

| Note: | This event does not run when a detection ticket status is updated. For example, changing a detection assignee will not cause the DETECTION_UPDATE event to run. This event also does not run for hidden detections. |
| --- | --- |

| Note: | You cannot assign triggers that run only on this event to specific devices or device groups. Triggers that run on this event will run whenever this event occurs. |
| --- | --- |

#### Properties

- **applianceId: Number**: If called on a

console

, returns the ID of the connected sensor that the detection occurred on. If called on a sensor, returns

`0`

.
- **assignee: String**: The assignee of the ticket associated with the detection.
- **categories: Array of Strings**: The list of categories the detection belongs to.

The following values are valid:

| Value | Category |
| --- | --- |
| `sec` | Security |
| `sec.action` | Actions on Objective |
| `sec.botnet` | Botnet |
| `sec.caution` | Caution |
| `sec.command` | Command & Control |
| `sec.cryptomining` | Cryptomining |
| `sec.dos` | Denial of Service |
| `sec.exfil` | Exfiltration |
| `sec.exploit` | Exploitation |
| `sec.hardening` | Hardening |
| `sec.lateral` | Lateral Movement |
| `sec.ransomware` | Ransomware |
| `sec.recon` | Reconnaissance |
| `perf` | Performance |
| `perf.auth` | Authorization & Access Control |
| `perf.db` | Database |
| `perf.network` | Network Infrastructure |
| `perf.service` | Service Degradation |
| `perf.storage` | Storage |
| `perf.virtual` | Desktop & App Virtualization |
| `perf.web` | Web Application |
- **description: String**: The description of the detection.

| Tip: | It is often easier to extract information about a detection from the `Detection.properties` property than parsing the `Detection.description` text. For more information, see the `Detection.properties` description. |
| --- | --- |

The following table shows common Markdown formats that you can include in the description:

| Format | Description | Example |
| --- | --- | --- |
| Headings | Place a number sign (#) and a space before your text to format headings. The level of heading is determined by the amount of number signs. | `#### Example H4 heading` |
| Unordered lists | Place a single asterisk (*) before your text. If possible, put each list item on a separate line. | `* First example``* Second example` |
| Ordered lists | Place a the number 1 and period (1.) before your text for each line item; Markdown will automatically increment the list number. If possible, put each list item on a separate line. | `1. First example``1. Second example` |
| Bold | Place double asterisks before and after your text. | `**bold text**` |
| Italics | Place an underscore before and after your text. | `_italicized text_` |
| Hyperlinks | Place link text in brackets before the URL in parentheses. Or type your URL. Links to external websites open in a new browser tab. Links within the ExtraHop system, such as dashboards, open in the current browser tab. | `[Visit our home page](https://www.extrahop.com)` `https://www.extrahop.com` |
| Blockquotes | Place a right angle bracket and a space before your text. | `On the ExtraHop website:` `> Access the live demo and review case studies.` |
| Emojis | Copy and paste an emoji image into the text box. See the [Unicode Emoji Chart](http://unicode.org/emoji/charts/full-emoji-list.html) website for images.Markdown syntax does not support emoji shortcodes. |  |
- **endTime: Number**: The time that the detection ended, expressed in milliseconds since the epoch.
- **id: Number**: The unique identifier for the detection.
- **isCustom: Boolean**: The value is

`true`

if the detection is a custom detection generated by a trigger.
- **isEventCreate: Boolean**: If the value is true, the

`DETECTION_UPDATE`

event ran when the detection was created. If the value is false, the

`DETECTION_UPDATE`

event ran when the detection was updated.
- **mitreCategories: Array of Objects**: An array of objects that contains the MITRE techniques and tactics associated with the detection. Each object contains the following properties:

- **id**: The ID of the MITRE technique or tactic.
- **name**: The name of the MITRE technique or tactic.
- **url**: The web address of the technique or tactic on the MITRE website.
- **participants: Array of Objects**: An array of participant objects associated with the detection. A participant object contains the following properties:

- **object: Object**: The Device, Application, or IP address object associated with the participant.
- **id: Number**: The ID of the participant.
- **role: String**: The role of the participant in the detection. The following values are valid:

- `offender`
- `victim`
- **properties: Object**: An object that contains the properties of the detection. Only built-in detection types include detection properties. The detection type determines which properties are available.

The field names of the object are the names of the detection properties. For example, the Anonymous FTP Auth Enabled detection type includes the `client_port` property, which you can access with the following code:

```javascript
Detection.properties.client_port
```

To view detection property names, view detection types with the `GET /detections/formats` operation in the ExtraHop REST API.

| Tip: | In the trigger editor, you can view valid detection properties with the autocomplete functionality if you include logic that determines the detection type. For example, if the trigger contains the following code, and you type a period after "properties", the trigger editor displays the valid properties for the Anonymous FTP Auth Enabled detection:if (Detection.type === 'anonymous_ftp') { Detection.properties } |
| --- | --- |
- **resolution: String**: The resolution of the ticket associated with the detection. Valid values are

`action_taken`

and

`no_action_taken`

.
- **riskScore: number | null**: The risk score of the detection.
- **startTime: Number**: The time that the detection started, expressed in milliseconds since the epoch.
- **status: String | null**: The status of the ticket associated with the detection. Valid string values are

`acknowledged`

,

`new`

,

`in_progress`

, and

`closed`

. The value is

`null`

if no status has been specified for the detection. On the Detections page, null statuses appear as

`Open`

.
- **ticketId: String**: The ID of the ticket associated with the detection.
- **title: String**: The title of the detection.
- **type: String**: The type of detection. For custom detections, "custom" is prepended to the user-defined string. For example, if you specify

`brute_force_attack`

in the

`commitDetection()`

function, the detection type is

`custom.brute_force_attack`

.
- **updateTime: Number**: The last time that the detection was updated, expressed in milliseconds since the epoch.
