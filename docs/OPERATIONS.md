# Sift: running cost, updates and backups

The parts of the app that concern money and data safety.

## Running cost

Everything measurable runs locally. The only paid part is the optional advice from
the Claude API, which needs your own key (Settings). A story request sends small
thumbnails of your picks. Reading a whole shoot (Cull with Claude) sends one to three
small thumbnails per moment: by the app's own estimate, about 600 frames cost roughly
$2 on the default model (Opus), $1 on Sonnet and 5 cents on Haiku. Each button shows
an estimate before and the actual cost after, and the model is chosen in Settings.
The briefing that opens every batch of a read (your brief, story plan and what the app has
learned) is frozen for the run and sent with prompt caching, so after the first batch the
API re-reads it at a tenth of the input price. The actual cost shown already counts this;
the estimate does not, so the real figure can come in lower.
With no key, everything else still works.

## Updating without losing anything

Everything Sift learns and every project live in `%APPDATA%\Sift`, never in the
folder the program is installed in. (Sift was called Atelier until version 0.2.12;
on first start it moves `%APPDATA%\Atelier` to the new name, so nothing is lost.) Installing a newer version over the old one
(or uninstalling) leaves that folder alone.

Every build is published as a GitHub release (`Sift-Setup-0.2.N.exe`). In the app,
Settings → Updates either finds it for you (add a fine-grained GitHub token with
*Contents: read-only* on this repository once) or installs one you downloaded
(*Install from a file*). Before installing, it copies your data into
`%APPDATA%\Sift\backups`. Settings → Your data also backs everything up to a
folder of your choice and restores it.

Backups are also made automatically, at most once a day and only when something
has changed, into the same `backups` folder. They do not pile up: the newest of each
of the last 7 days stays, then the newest of each of the 4 weeks after that.
The copies made before an update (newest 3) and before a restore (newest 2) are
trimmed the same way, so the folder stays at roughly a dozen copies of the data
(never the preview caches). A file that has not changed since the previous backup
is not copied again but linked to the earlier copy, so repeated backups of a big
shoot take space only for what changed (the first one holds everything). Backups you save to a folder of your own are yours to
manage.
