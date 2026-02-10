Going back to DCL clearance flow, let's make some improvements: 

- While we have a DCL request ongoing, hide the OK button in the clearance dialog, it's easily confused with Send. 
  If the user wants to revert to voice, he/she needs to first click Reject, then OK. But always show the Cancel button (closes
  the dialog without further action, unless clearance flag is set = unset). So when DCL status = REQUEST:
  Cancel, Reject, Send

- When DCL status=SENT, we should still have the Reject option. So Cancel, Reject (not OK).

- Poll messages right away after successful login (in case we've inadvertently logged out we want to 
  get new messages right away)

- Temporarily decrease the polling interval to 20-25 seconds for a maximum period of 5 minutes when we've
  sent a request that we're expecting a response from (i.e. the cpdlc content contains /WU/ or /AN/ or /R/),
  until we've received the response (or timeout).

