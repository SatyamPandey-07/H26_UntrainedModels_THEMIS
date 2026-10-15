# Sandbox flags

| Phase                 | Network                                    | Flags                                                                                                  |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Install (image build) | registry access                            | `docker build --pull=false -f docker/sandbox.Dockerfile`                                               |
| Tests, lint, scans    | none                                       | `--network none --memory 2g --cpus 2 --pids-limit 512 --security-opt no-new-privileges --cap-drop ALL` |
| App for probes        | none, port published to host loopback only | as above plus `-p 127.0.0.1::<port>`                                                                   |

Source inside the image is owned by root and read-only to the run user (`--read-only` root filesystem
with a `tmpfs` at `/tmp` and the test cache path). Output that tools must write goes to `/tmp`.

Both refs are built from a clean `git archive` export of their commit, never from a working copy, so local
untracked files cannot leak in.
