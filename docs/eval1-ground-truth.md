# Evaluation 1 — ground truth

**Written before running any tool, from the raw transcripts only.**

The method matters. If the ground truth were derived from the tagged study files, the
evaluation would be circular: the tool would be marked against its own input. So these
findings were written by reading the raw Whisper transcripts of the first three minutes of
two EV charging interviews, with the tagged files closed.

Source: `Interview-Tesla User.mp4` (P01, Tesla Model X owner) and
`Interview with Non Tesla user.mp4` (P02, Chevrolet Bolt owner). Transcribed with
Whisper `tiny.en`, so wording is approximate.

A finding counts as **found** only if a tool surfaces it without the reader already knowing
it was there.

---

## F1. Price is the first filter, not brand loyalty

P01 defaults to ChargePoint because it is "one of the most economical prices in my area."
P02 uses "whatever's available at the cheapest rate" for errands. Both pick on cost before
anything else.

## F2. Queue length overrides price

P01 abandons the cheaper option when it is busy: "if that one is busy and the wait time is
long, I would just go further down half a block to the Tesla chargers." Price wins until
waiting costs more than the saving.

## F3. Trip type switches the decision entirely

P02 behaves differently on road trips: cheapest for errands, Supercharger for distance,
because it is "the most convenient and most widely available." Two different mental models
in one person.

## F4. Workplace charging removes the public charging problem

P02 uses public charging "maybe once every two months" because "I get charging at work."
The strongest predictor of public-charging pain is whether you have another option.

## F5. Starting a session on a non-Tesla network is a seven-step sequence

P02 describes: go to station, read screen instructions, unplug connector, plug into car,
follow app prompt, wait 30 seconds to initialise, then a breaker trips. That last step is
treated as the normal signal that charging began.

## F6. Supercharger's advantage is the absence of interface

"Most of it is done through the app. There's no UI on the charger." Said in direct contrast
to the sequence in F5.

## F7. A non-Tesla owner volunteers that Tesla leads on speed and reliability

Notable because of who said it. P02 drives a Bolt.

## F8. Broken chargers are survivable because the network flags them

P01: "They're typically good about notifying the chargers that don't work, so we know what
stations not to charge in." The failure is tolerated because the information is good.

## F9. Users do the maintenance reporting themselves

P01 complained about a dead charger and "then they put the board on. So it's more like a
community work there." Users act as the fault-detection layer.

## F10. Slow charging at busy sites is accepted as normal

P01: "when there are too many cars in the same charging spot, we do experience slow charging,
but that's typical, any EV owner will tell you." Normalised, so it would not surface in a
complaints-led analysis.

## F11. Usage frequency differs by an order of magnitude

P01 charges publicly twice a week. P02 once every two months. Same study, wildly different
exposure, which should qualify every other comparison between them.

---

**11 findings. Scored in `eval1-results.md`.**
