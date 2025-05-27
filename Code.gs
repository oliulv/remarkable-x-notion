/**
 * Image and Task to Notion Journal Script
 */

// SETUP INSTRUCTIONS & SCRIPT CONFIG (No changes here, ensure they are set in PropertiesService)

function syncImagesAndTasksToNotion() {
  try {
    Logger.log('Starting Image and Task to Notion sync process...');
    const config = getConfiguration();
    if (!config) {
      Logger.log('Configuration incomplete. Please check script properties.');
      return;
    }
    const labels = getGmailLabels();
    if (!labels.syncLabel || !labels.syncedLabel) {
      Logger.log('Required Gmail labels not found. Please create "NotionToSync" and "SyncedToNotion" labels.');
      return;
    }
    const threads = labels.syncLabel.getThreads();
    Logger.log(`Found ${threads.length} threads to process`);
    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i];
      const messages = thread.getMessages();
      let threadProcessedSuccessfully = true;
      for (let j = 0; j < messages.length; j++) {
        const message = messages[j];
        try {
          Logger.log(`Processing message ID: ${message.getId()}, Subject: ${message.getSubject()}`);
          processEmailMessage(message, config); // This function will now handle image and tasks
        } catch (error) {
          Logger.log("--- ERROR_CAUGHT_IN_MESSAGE_PROCESSING_LOOP (syncImagesAndTasksToNotion) ---");
          let errMessage = "Unknown error structure in syncImagesAndTasksToNotion catch";
          let errStack = "No stack available in syncImagesAndTasksToNotion catch";
          try {
            if (error) {
              errMessage = error.toString();
              if (error.stack) errStack = error.stack;
              Logger.log(`Raw error object: ${JSON.stringify(error)}`);
            }
          } catch (e) {
            Logger.log("Error while trying to get error details in syncImagesAndTasksToNotion: " + e.toString());
            errMessage = "Failed to extract error details from caught error in syncImagesAndTasksToNotion."
          }
          Logger.log(`Caught error processing message ${j} (ID: ${message.getId()}) in thread ${i}. Error Message: ${errMessage}. Stack: ${errStack}`);
          threadProcessedSuccessfully = false;
        }
      }
      if (threadProcessedSuccessfully) {
        try {
          thread.removeLabel(labels.syncLabel);
          thread.addLabel(labels.syncedLabel);
          Logger.log(`Updated labels for thread: ${thread.getFirstMessageSubject()}`);
        } catch (error) {
          Logger.log(`Error updating labels for thread: ${error.toString()}`);
        }
      } else {
        Logger.log(`Skipping label update for thread ${thread.getFirstMessageSubject()} due to processing errors in one or more messages.`);
      }
    }
    Logger.log('Image and Task to Notion sync process completed');
  } catch (error) {
    Logger.log(`Fatal error in syncImagesAndTasksToNotion: ${error.toString()}. Stack: ${error.stack}`);
  }
}

function getConfiguration() {
  try {
    const properties = PropertiesService.getScriptProperties();
    const config = {
      NOTION_API_KEY: properties.getProperty('NOTION_API_KEY'),
      JOURNAL_DATABASE_ID: properties.getProperty('JOURNAL_DATABASE_ID'),
      JOURNALING_PAGE_ID: properties.getProperty('JOURNALING_PAGE_ID'),
      TASKS_DATABASE_ID: properties.getProperty('TASKS_DATABASE_ID'), // NEW: For your Tasks database
      OPENAI_API_KEY: properties.getProperty('OPENAI_API_KEY')       // NEW: For OpenAI
    };
    for (const [key, value] of Object.entries(config)) {
      if (!value) {
        Logger.log(`Missing required property: ${key}`);
        return null;
      }
    }
    Logger.log('Configuration loaded successfully');
    return config;
  } catch (error) {
    Logger.log(`Error loading configuration: ${error.toString()}. Stack: ${error.stack}`);
    return null;
  }
}

function getGmailLabels() {
  try {
    const syncLabel = getOrCreateLabel('NotionToSync');
    const syncedLabel = getOrCreateLabel('SyncedToNotion');
    if (!syncLabel || !syncedLabel) {
        Logger.log('One or both Gmail labels could not be retrieved or created.');
        return {};
    }
    return { syncLabel: syncLabel, syncedLabel: syncedLabel };
  } catch (error) {
    Logger.log(`Error managing Gmail labels: ${error.toString()}. Stack: ${error.stack}`);
    return {};
  }
}

function getOrCreateLabel(labelName) {
  try {
    let label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      label = GmailApp.createLabel(labelName);
      Logger.log(`Created Gmail label: ${labelName}`);
    }
    return label;
  } catch (error) {
    Logger.log(`Error with label ${labelName}: ${error.toString()}. Stack: ${error.stack}`);
    return null;
  }
}

function processEmailMessage(message, config) {
  Logger.log(`Processing message content for: ${message.getSubject()}`);
  const attachments = message.getAttachments();
  const pngAttachment = attachments.find(att => att.getContentType() === 'image/png');

  if (!pngAttachment) {
    Logger.log('No PNG attachment found in message. Skipping this message.');
    return;
  }
  if (attachments.filter(att => att.getContentType() === 'image/png').length > 1) {
      Logger.log(`Warning: Multiple PNG attachments found. Processing the first one: ${pngAttachment.getName()}`);
  }
  Logger.log(`Found PNG attachment: ${pngAttachment.getName()}`);

  // 1. Create Journal Page in Notion
  const pageId = createNotionJournalPage(message, config); // Will throw error if fails

  // 2. Upload and Embed PNG in the newly created Journal Page
  uploadAndEmbedImage(pageId, pngAttachment, config); // Will throw error if fails

  // 3. Extract tasks from the PNG using OpenAI
  try {
    const tasks = extractTasksFromImage(pngAttachment, config);
    if (tasks && tasks.length > 0) {
      Logger.log(`Extracted tasks: ${JSON.stringify(tasks)}`);
      // 4. Create entries in the Tasks Database for each extracted task
      for (const task of tasks) {
        createNotionTask(task, message.getDate(), config);
      }
    } else {
      Logger.log('No tasks extracted from the image or OpenAI returned an empty list.');
    }
  } catch (error) {
    Logger.log(`Error extracting or creating tasks: ${error.toString()}. Continuing with journal page processing.`);
    // Do not re-throw here, as we still want the journal page to be processed and labeled.
  }

  Logger.log(`Successfully processed message, embedded image, and attempted task extraction for: ${message.getSubject()}`);
}


function createNotionJournalPage(message, config) {
  try {
    const emailDate = message.getDate();
    const formattedDate = Utilities.formatDate(emailDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    // Get "Day of week name" (e.g., "Monday", "Tuesday")
    const dayOfWeek = Utilities.formatDate(emailDate, Session.getScriptTimeZone(), 'EEEE');

    // New title format: "Journal Entry, {day of week}: {date}"
    const pageTitle = `Journal Entry - ${dayOfWeek}: ${formattedDate}`;

    Logger.log(`Attempting to create Notion page with title: "${pageTitle}"`);

    const pagePayload = {
      parent: { database_id: config.JOURNAL_DATABASE_ID },
      properties: {
        Name: { title: [{ text: { content: pageTitle } }] },
        Date: { date: { start: formattedDate } },
        'Area/Resource': { relation: [{ id: config.JOURNALING_PAGE_ID }] }
      }
    };
    const response = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      payload: JSON.stringify(pagePayload),
      muteHttpExceptions: true
    });
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    if (responseCode !== 200) {
      Logger.log(`Error creating Notion page. Code: ${responseCode}, Response: ${responseText}`);
      throw new Error(`Notion API error creating page: ${responseCode} - ${responseText}`);
    }
    const pageData = JSON.parse(responseText);
    const pageId = pageData.id;
    Logger.log(`Created Notion page: "${pageTitle}" (ID: ${pageId})`);
    return pageId;
  } catch (error) {
    Logger.log(`Error in createNotionJournalPage: ${error.toString()}. Stack: ${error.stack}`);
    throw error;
  }
}

function uploadAndEmbedImage(pageId, imageAttachment, config) {
  let attachmentNameForErrorLogging = "Unknown Attachment";
  try {
    attachmentNameForErrorLogging = imageAttachment ? imageAttachment.getName() : "imageAttachment object null";
    const imageBlob = imageAttachment.getAs('image/png'); // Ensure it's treated as PNG
    const fileName = imageAttachment.getName() || 'journal_image_upload.png'; // Fallback filename
    Logger.log(`Starting image upload for: ${fileName}, Page ID: ${pageId}`);

    // Step 1: Initiate Upload with Notion
    Logger.log('Step 1: Initiating file upload with Notion...');
    const initPayload = { file_name: fileName, file_type: 'image/png', mode: 'single_part' };
    const initResp = UrlFetchApp.fetch('https://api.notion.com/v1/file_uploads', {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + config.NOTION_API_KEY, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      payload: JSON.stringify(initPayload),
      muteHttpExceptions: true
    });
    const initRespCode = initResp.getResponseCode();
    const initRespText = initResp.getContentText();
    Logger.log(`Step 1 Response - Code: ${initRespCode}, Text: ${initRespText}`);

    if (initRespCode !== 200) {
      throw new Error(`Init upload failed (Code ${initRespCode}): ${initRespText}`);
    }

    const initData = JSON.parse(initRespText);
    if (!initData || typeof initData.id === 'undefined') {
        Logger.log(`ERROR: initData is missing 'id'. initData: ${JSON.stringify(initData)}`);
        throw new Error("Parsed initData from Step 1 is missing 'id'.");
    }
    const uploadId  = initData.id;

    // Step 2: Upload Bytes to Notion's /send endpoint
    const sendEndpointUrl = `https://api.notion.com/v1/file_uploads/${uploadId}/send`;
    Logger.log(`Step 2: Uploading image bytes to Notion endpoint: ${sendEndpointUrl} ...`);

    const putResp = UrlFetchApp.fetch(sendEndpointUrl, {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + config.NOTION_API_KEY,
        'Notion-Version': '2022-06-28'
      },
      payload: { // This handles multipart/form-data
        file: imageBlob // The image blob is sent as a form field named 'file'
      },
      muteHttpExceptions: true
    });
    const putRespCode = putResp.getResponseCode();
    const putRespText = putResp.getContentText();
    Logger.log(`Step 2 Response - Code: ${putRespCode}, Text: ${putRespText}`);
    if (putRespCode !== 200) {
      throw new Error(`POST to Notion /send endpoint failed (Code ${putRespCode}): ${putRespText}`);
    }
    Logger.log('Step 2 Success: Image bytes uploaded to Notion /send endpoint.');

    // Step 3: Append Image Block
    Logger.log(`Step 3: Appending image block to page ${pageId} using Upload ID: ${uploadId}...`);
    // IMPORTANT: Notion expects 'file_upload' for image blocks with an upload ID, not 'pdf'
    const blockPayload = { children: [{ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: uploadId } } }] };
    const blkResp = UrlFetchApp.fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'patch',
      headers: {
        'Authorization': `Bearer ${config.NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      payload: JSON.stringify(blockPayload),
      muteHttpExceptions: true
    });
    const blkRespCode = blkResp.getResponseCode();
    const blkRespText = blkResp.getContentText();
    Logger.log(`Step 3 Append Block Response - Code: ${blkRespCode}, Text: ${blkRespText}`);
    if (blkRespCode !== 200) {
      throw new Error(`Appending image block failed (Code ${blkRespCode}): ${blkRespText}`);
    }
    Logger.log(`✅ Image embedded successfully! Page ID: ${pageId}, Upload ID: ${uploadId}`);
  } catch (err) {
    Logger.log("--- ERROR_CAUGHT_IN_UPLOAD_AND_EMBED_IMAGE ---");
    let errMsg = "Unknown upload error structure";
    let errStack = "No upload stack available";
    try {
        if (err) {
            errMsg = err.toString();
            if (err.stack) errStack = err.stack;
        }
    } catch (e) {
        Logger.log("Error while trying to get upload error details: " + e.toString());
        errMsg = "Failed to extract upload error details."
    }
    Logger.log(`Caught error during image upload for file "${attachmentNameForErrorLogging}". Error Message: ${errMsg}. Stack: ${errStack}`);
    throw err;
  }
}

function extractTasksFromImage(imageAttachment, config) {
  Logger.log('Attempting to extract tasks from image using OpenAI Vision API...');
  const base64Image = Utilities.base64Encode(imageAttachment.getBytes());

  const payload = {
    model: "gpt-4o", // Changed to gpt-4o as it's better for vision tasks, "gpt-4.1-nano" is not a standard OpenAI model.
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Identify any handwritten tasks or to-do items from this image. Tasks are often listed under goals. Return the tasks as a comma-separated list. If there are no tasks, return an empty string. Do not return the goals. Example: 'Task 1, Task 2, Another task'."
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${base64Image}`
            }
          }
        ]
      }
    ],
    max_tokens: 300 // Adjust as needed
  };

  try {
    const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
      Logger.log(`OpenAI API error. Code: ${responseCode}, Response: ${responseText}`);
      throw new Error(`OpenAI API error: ${responseCode} - ${responseText}`);
    }

    const responseData = JSON.parse(responseText);
    const rawContent = responseData.choices[0].message.content.trim();

    // Split the string by comma and trim each task
    const tasks = rawContent.split(',').map(task => task.trim()).filter(task => task !== "");

    Logger.log(`OpenAI returned: ${rawContent}`);
    return tasks;

  } catch (error) {
    Logger.log(`Error in extractTasksFromImage: ${error.toString()}. Stack: ${error.stack}`);
    throw error;
  }
}

function createNotionTask(taskName, taskDate, config) {
  try {
    const formattedDate = Utilities.formatDate(taskDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    Logger.log(`Attempting to create Notion task: "${taskName}" for date: ${formattedDate}`);

    const taskPayload = {
      parent: { database_id: config.TASKS_DATABASE_ID },
      icon: { // Add this icon property
        type: "emoji",
        emoji: "✔️" // This is the blue checkmark emoji
      },
      properties: {
        Name: { title: [{ text: { content: taskName } }] },
        Due: { date: { start: formattedDate } }
        // You can add more properties here if your Tasks database has them
        // e.g., Status: { select: { name: 'To Do' } }
      }
    };

    const response = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      payload: JSON.stringify(taskPayload),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
      Logger.log(`Error creating Notion task. Code: ${responseCode}, Response: ${responseText}`);
      throw new Error(`Notion API error creating task: ${responseCode} - ${responseText}`);
    }
    const taskData = JSON.parse(responseText);
    Logger.log(`Created Notion task: "${taskName}" (ID: ${taskData.id})`);
    return taskData.id;
  } catch (error) {
    Logger.log(`Error in createNotionTask: ${error.toString()}. Stack: ${error.stack}`);
    throw error;
  }
}

// Test functions (testConfiguration, testNotionPageCreation) can remain as they were.
// Ensure they are not the ones being run by the trigger.
function testConfiguration() {
  Logger.log('Testing configuration...');
  const config = getConfiguration();
  if (!config) { Logger.log('❌ Configuration test failed due to missing properties.'); return; }
  Logger.log('✅ Configuration loaded successfully:');
  Logger.log(`  Journal Database ID: ${config.JOURNAL_DATABASE_ID}`);
  Logger.log(`  Journaling Page ID: ${config.JOURNALING_PAGE_ID}`);
  Logger.log(`  Tasks Database ID: ${config.TASKS_DATABASE_ID}`);
  Logger.log(`  API Key present: ${config.NOTION_API_KEY ? 'Yes' : 'No (CRITICAL ERROR)'}`);
  Logger.log(`  OpenAI API Key present: ${config.OPENAI_API_KEY ? 'Yes' : 'No (CRITICAL ERROR)'}`);
  const labels = getGmailLabels();
  if (labels.syncLabel && labels.syncedLabel) { Logger.log(`✅ Gmail labels ready: "${labels.syncLabel.getName()}", "${labels.syncedLabel.getName()}"`);
  } else { Logger.log('❌ Gmail labels not ready. Check for errors above in getGmailLabels.'); }
}

function testNotionPageCreation() {
  Logger.log('Testing Notion Page Creation...');
  try {
    const config = getConfiguration();
    if (!config) { Logger.log('Configuration not ready for page creation test.'); return; }
    const mockMessage = { getDate: function() { return new Date(); }, getSubject: function() { return "Test Page Creation Subject"; } };
    Logger.log('Attempting to create a test Notion page...');
    const pageId = createNotionJournalPage(mockMessage, config);
    if (pageId) { Logger.log(`✅ Test page created successfully with ID: ${pageId}. You can delete this page in Notion.`);
    } else { Logger.log('❌ Test page creation failed. See previous logs for details from createNotionJournalPage.'); }
  } catch (error) { Logger.log(`❌ Test Notion Page Creation failed with error: ${error.toString()}. Stack: ${error.stack}`); }
}

function testTaskCreation() {
  Logger.log('Testing Notion Task Creation...');
  try {
    const config = getConfiguration();
    if (!config) { Logger.log('Configuration not ready for task creation test.'); return; }
    const testTaskName = "Buy groceries";
    const testTaskDate = new Date(); // Today's date
    Logger.log(`Attempting to create a test Notion task: "${testTaskName}"`);
    const taskId = createNotionTask(testTaskName, testTaskDate, config);
    if (taskId) { Logger.log(`✅ Test task created successfully with ID: ${taskId}. You can delete this task in Notion.`);
    } else { Logger.log('❌ Test task creation failed. See previous logs for details from createNotionTask.'); }
  } catch (error) { Logger.log(`❌ Test Notion Task Creation failed with error: ${error.toString()}. Stack: ${error.stack}`); }
}

function testImageToTaskExtraction() {
  Logger.log('Testing Image to Task Extraction (requires a mock PNG attachment)...');
  try {
    const config = getConfiguration();
    if (!config) { Logger.log('Configuration not ready for image extraction test.'); return; }

    // Create a dummy PNG blob for testing. In a real scenario, this would come from an email.
    // This is a minimal valid PNG. For better testing, replace with a real PNG bytes.
    // This example PNG is a tiny 1x1 black pixel.
    const dummyPngBytes = [
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 1, 115, 82, 71, 66, 0, 174, 206, 28, 233, 0, 0, 0, 4, 103, 65, 77, 65, 0, 0, 177, 143, 11, 252, 97, 5, 0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 14, 195, 0, 0, 14, 195, 1, 49, 200, 198, 116, 0, 0, 0, 12, 73, 68, 65, 84, 8, 223, 99, 120, 1, 1, 0, 0, 0, 128, 0, 1, 10, 105, 185, 202, 190, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
    ];
    const dummyPngBlob = Utilities.newBlob(dummyPngBytes, 'image/png', 'test_handwriting.png');

    // Mock a Gmail attachment object
    const mockAttachment = {
      getName: () => 'test_handwriting.png',
      getContentType: () => 'image/png',
      getBytes: () => dummyPngBytes, // Use the bytes directly for getBytes()
      getAs: (type) => {
        if (type === 'image/png') return dummyPngBlob;
        throw new Error('Unsupported conversion type for mock attachment');
      }
    };

    Logger.log('Attempting to extract tasks from mock PNG...');
    const extractedTasks = extractTasksFromImage(mockAttachment, config);

    if (extractedTasks) {
      Logger.log(`✅ Extracted tasks: ${JSON.stringify(extractedTasks)}`);
      // Optionally create tasks in Notion if needed for full test
      // for (const task of extractedTasks) {
      //   createNotionTask(task, new Date(), config);
      // }
    } else {
      Logger.log('❌ Task extraction failed or returned no tasks. See previous logs for details.');
    }
  } catch (error) {
    Logger.log(`❌ Image to Task Extraction failed with error: ${error.toString()}. Stack: ${error.stack}`);
  }
}
