# VatEFS

Work in progress...

Is gonna be Electronic Flight Strip application for VATSIM. And it's gon be fantastic.


Run backend with recording:

```sh
cd backend
npm start -- --airport ESSA --callsign ESSA_W_TWR --record ./session.log
```

Stop, rerun without recording:

```sh
npm start -- --airport ESSA --callsign ESSA_W_TWR
```

Playback:

```sh
npm run playback -- ./session.log --speed 2.0
```
