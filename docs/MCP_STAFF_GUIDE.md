# Saving an MP4 to the LMS from ChatGPT

The server tools are implemented, but rollout and file delivery from the intended desktop/web clients
must be verified before staff use them with real content. Ask the LMS administrator whether the pilot is enabled.

## Connect once

1. Get the MCP URL from the LMS administrator (the configured LMS origin followed by `/mcp/`).
2. In a ChatGPT account/workspace that permits custom MCP servers, add the custom connection as **LMS**.
3. Sign in with your own LMS account and review the consent page. Curriculum access and pilot membership
   are required; knowing the connection URL does not grant access.
4. Select the LMS connection in the chat. Desktop device access and the web client's file-transfer capability
   are separate capabilities; the administrator must verify the handoff in each intended client.

## Save a video

Make the MP4 available using your client's supported file/device access, then ask:

> Save this MP4 in programme [name], module [name], week [name], video component [name].

The assistant looks up existing records. If names are ambiguous, it asks which item you mean. It can reuse
an existing video component or, when component creation is enabled, preview a new one in an existing draft
module/week. Confirm creation first, then confirm the separate MP4 upload preview. Nothing is published.

Read the preview and confirm it. The server then saves the playable LMS source and queues the Bunny copy.
Ask for the video's import status when needed; copying and encoding may still be pending after the LMS save.

## Create a component

> Create a Video component named Inspector MP4 Test in programme [name], module [name], week [name].

Supported types: video, podcast, reading, PowerPoint, quiz, assignment, reflection, checkpoint,
monthly KSB quiz and coaching preparation. These are draft containers with the LMS's type settings;
creation does not generate questions or upload content for those other types. The existing video tool
can fill a video container. Modules and weeks must already exist. Teams sessions and recordings are excluded.

## If something goes wrong

- A failed preview has not changed curriculum content.
- An expired preview, changed destination or modified video requires a new preview.
- A repeated apply of the same confirmed preview performs no second upload.
- If the save outcome is **unknown**, check the component/status before uploading again; it may already be saved.
- If the current source differs from the latest Bunny import, the old copy is not reported as the current video.
- If ChatGPT cannot supply the file, report that to the administrator. Pasting a device path or a chat link alone
  does not transfer the MP4 to the server. No separate folder-watching uploader is installed by this integration.

The MP4 limit is 300 MB. Review saved content in the LMS and publish through the normal LMS workflow.
