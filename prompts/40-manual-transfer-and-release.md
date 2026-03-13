## Manual transfer and release

Let's add two options to the context menu of assumed strips:

1. Release - sends the "release" message to the plugin, resets "controller" field

2. Manual transfer - shows another dropdown of other controllers (callsign and frequency, sorted so that if the
   callsign starts with one of 'my airports' it's at the top, then alphabetically) - when other controller is
   selected, initiates transfer to that specific controller.

The manual transfer sends "transfer" message with "targetCallsign" set.
