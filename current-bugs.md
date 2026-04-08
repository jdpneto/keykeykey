## Extension

1 - When I import a csv, the files are not uploaded to google. A sync needs to be triggered and maybe a spinner will show while we upload all new items (right away if an empty vault, after clicking "merge" or another option if not). This does not work for the desktop at the very least

2- Starting the app or unlocking the extension should trigger an auto-sync. And it should auto-sync anyways to see if something changed in another place (eg: extension adds new login and desktop then downloads on start). Maybe once a minute.

3- In the extension, if I unfocus the extension mid-import, it won't finish. We should found a way to have this work in the background or for the extension to not lose where it was while the load happens.

4- Yesterday a "restore from google drive" button was added if a token is detected. We need to also add the same for dropbox and onedrive. I don~t want people to have to go into the extension after already signing in. The flow should be the same and the button should be the last attempted connection that succeeded
