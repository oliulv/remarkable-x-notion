# Image and Task to Notion Journal Script

Automate sending handwritten journal notes (PNG) from your reMarkable tablet (or any device) via Gmail to Notion. Simply email your note as a PNG, and the script will:

* Create a daily journal page in Notion, titled with the date and day of week
* Upload and embed the first PNG attachment in the journal entry
* Use OpenAI Vision to extract handwritten tasks from the image
* Add each extracted task to your Notion Tasks database with the correct due date

Everything runs automatically once you send your handwritten note from the tablet to your Gmail account.

## Pre-requisites

* **reMarkable tablet** (or any device that can email PNGs)
* **Gmail account**: to receive notes and host the script
* **Notion account**: with permission to create integrations and databases
* **OpenAI API key**: for task extraction via Vision

## Setup

### 1. Gmail Configuration

1. Create two labels in Gmail:

   * `NotionToSync` — incoming emails to process
   * `SyncedToNotion` — applied after successful sync
2. Create a filter to automatically tag as `NotionToSync` all incoming emails from **[my@remarkable.com](mailto:my@remarkable.com)**.
3. (Optional) You can also send PNGs from other tablets or devices; add their sender addresses to additional filters as needed.

### 2. Notion Integration

1. In Notion, go to **Settings & Members > Integrations > Develop your own integrations**.
2. Click **+ New integration**, name it e.g. *Journal Sync*, and grant it **Insert content** permission.
3. Copy the **Internal Integration Token** (your Notion API key).
4. **Share** each target database/page with this integration:

   * **Journal Database**: where daily entries will be created
   * **Journaling Page** (optional): a parent page or template relation
   * **Tasks Database**: where extracted tasks will be stored
5. Retrieve the IDs:

   * For each database or page, copy its URL and extract the ID (the 32-character string).

### 3. Google Apps Script Setup

1. Open [Google Apps Script](https://script.google.com/) and **Create project**.
2. Name it (e.g., *Image and Task to Notion*).
3. In **Project Settings**, under **Script Properties**, add the following keys and their values:

   * `NOTION_API_KEY`: your Notion integration token
   * `JOURNAL_DATABASE_ID`: ID of your Journal database
   * `JOURNALING_PAGE_ID`: ID of your Journaling page relation
   * `TASKS_DATABASE_ID`: ID of your Tasks database
   * `OPENAI_API_KEY`: your OpenAI API key
4. Copy the provided Google Apps Script code into the editor and **Save**.

### 4. Trigger Configuration

1. In the Apps Script editor, go to **Triggers** (clock icon).
2. Click **Add Trigger**:

   * **Choose function**: `syncImagesAndTasksToNotion`
   * **Select event source**: Time-driven
   * **Select type of time-based trigger**: e.g., Hour timer
   * **Select interval**: e.g., Every hour (or customize)
3. Save the trigger; grant authorization when prompted.

## Usage

1. Create or handwritten note on your reMarkable tablet and use its share feature to email the PNG to your Gmail address.
2. The filter tags it as `NotionToSync` (or manual label).
3. The script runs on its schedule, processes new emails, and:

   * Creates a journal entry in Notion
   * Embeds the image
   * Extracts handwritten tasks and adds them to your Tasks database
4. Processed emails are relabeled to `SyncedToNotion`.

## Notes

* Only the **first** PNG attachment per email is processed; additional PNGs generate a warning and are ignored.
* Supports notes from reMarkable and other tablets—just adjust your Gmail filters.
* If OpenAI cannot extract tasks or returns none, the script continues without creating tasks.
* All errors are logged in the Apps Script **Logs** (View > Logs).

## Configuration Reference

| Property Key          | Description                                 |
| --------------------- | ------------------------------------------- |
| `NOTION_API_KEY`      | Notion integration token                    |
| `JOURNAL_DATABASE_ID` | ID of the Journal entries database          |
| `JOURNALING_PAGE_ID`  | ID of the parent page/template relation     |
| `TASKS_DATABASE_ID`   | ID of the Tasks database                    |
| `OPENAI_API_KEY`      | OpenAI API key for image-to-text extraction |

That's it! Your handwritten journal notes are now live in Notion, complete with tasks extracted automatically. 🎉
