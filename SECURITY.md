# Security

This project is intended for a trusted LAN or VPN, not an audited public multi-user service.

- Do not commit `.env`, personal media, person data, thumbnail caches or access tokens.
- Authenticated media and API URLs contain access credentials inherited from Erin. Treat them as secrets.
- Use trusted metadata only; captions may contain HTML.
- Writeable media mounts allow upload and permanent deletion. Use read-only mounts for viewing-only installations.
- Back up source videos independently. The delete action has no recycle bin.

Please avoid posting credentials or private media in public issues. GitHub private vulnerability reporting can be used if enabled on this repository; otherwise contact the maintainer privately before publishing reproduction data containing secrets.
