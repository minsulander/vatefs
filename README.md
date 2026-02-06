# VatEFS

Work in progress...

This is a highly vibe-coded project, mainly using Claude.
You'll find most/some of the prompts used under `prompts/` for whatever that's worth... it's kinda like a new form of source code in this era I reckon.

## Building & Running

Run with mock data:
```sh
cd backend
npm start -- --mock
cd ../frontend
npm start
```

Some other options:
```sh
# Online mode - airports discovered from EuroScope's rwyconfig
npm start

# Mock mode - defaults to ESGG
npm start -- --mock

# Offline mode with specific airport(s)
npm start -- --airport ESGG
npm start -- --airport ESGG,ESSA,ESMS

# Combined with other options
npm start -- --mock --airport ESSA --callsign ESSA_TWR
```

Run backend with recording:

```sh
cd backend
npm start -- --airport ESGG --callsign ESGG_TWR --record ./logs/esgg.log
```

Stop, rerun without recording:

```sh
npm start -- --airport ESGG --callsign ESGG_TWR
```

Playback:

```sh
npm run playback -- ./logs/esgg.log --speed 2.0
```

## Contributing

Heck yeah, if you wanna help, go for it... make issues or pull requests or whatever you fancy.
