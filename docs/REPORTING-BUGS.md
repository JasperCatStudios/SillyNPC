# How to report a bug

Thank you for helping. A good report lets the problem be found and fixed quickly. Report bugs on the [issues page](https://github.com/JasperCatStudios/WorldKit/issues).

Worldkit is in beta in two places: **Activities** and **mobile**. Reports about both are welcome, but expect rough edges there.

## Before you report

1. **Update.** In SillyTavern, open **Extensions** and update Worldkit, then reload the page. The bug may be fixed already.
2. **Turn things off to narrow it down.** In **Worldkit menu, Modules**, switch off the modules you are not using. If the problem goes away, tell us which one caused it. If it only happens with **Enable Worldkit** on (Advanced tab), say so.
3. **Look for the same problem** on the issues page. Add a comment to an existing report instead of opening a new one.

## What to put in the report

Copy this list into the report and fill it in:

- **What happened**, and **what you expected**.
- **Steps to make it happen.** Number them: "1. Open Activities. 2. Pick Tea Time. 3. ..."
- **Where:** which module or tab (Phone, Games, Combat, Activities, Scene, a tracker, Voices, Content Kit...).
- **Worldkit version.** It is in the extension's `manifest.json` (the `version` line), or in SillyTavern's Extensions list.
- **SillyTavern version** and whether you use the `release` or `staging` branch.
- **Device and browser**, for example "Windows, Chrome" or "Android phone, Chrome". Say if it is the mobile layout.
- **Connections:** which AI service and model the feature used, if it is about text that was written (trackers, phone, tea talk). The same for a voice or image service.
- **A screenshot or short screen recording**, if it is about how something looks.
- **The browser console messages**, if something broke (see below).

## How to get the console messages

The console is where the browser writes errors. Most crashes leave a line there.

1. Press **F12** (on Mac, Cmd+Option+I) in your browser to open the developer tools. Choose the **Console** tab.
2. Make the problem happen again.
3. Look for red lines. Right-click, **Save as...** or copy them into the report.

For more detail, turn on **Worldkit menu, Advanced, Log Requests To The Console** before you repeat the steps. It writes what Worldkit sends and receives. Turn it off again afterwards, because it is noisy.

On a phone, use a desktop browser if you can, or say that you could not get the console.

## What Worldkit sent to the model

For problems with what a model wrote, the **Prompts** tab shows every instruction Worldkit sends. Copy the prompt that looks relevant. Say if you changed any prompt from its default. The **Restore default** button next to a prompt resets it, and is worth trying first.

## Keep private things out

Before you post:

- **Remove API keys, tokens and passwords.** They can show up in console output and screenshots.
- Hide personal chat text and character details you do not want public. A short invented example that shows the same problem is better than your real chat.
- Do not attach your whole SillyTavern `data` folder or settings file.

## Tips for a faster fix

- One problem per report.
- If it only happens with a certain character, world or setting, say which.
- If you found a workaround, mention it.
- Say if it used to work and when it stopped.

## Ideas and questions

Not a bug? Suggestions are welcome on the same issues page. Start the title with "Idea:" or "Question:".
