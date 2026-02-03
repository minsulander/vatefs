# VatEFS

Work in progress...

Is gonna be Electronic Flight Strip application for VATSIM. And it's gon be fantastic.

Run with mock data:
```sh
cd backend
npm start -- --mock
cd ../frontend
npm start
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
