// ==UserScript==
// @name         PurplePortGreeter TEST
// @author       herta
// @namespace    herta
// @version      0.2.1-test
// @description  TEST build: validates PurplePort message automation without automatic sending
// @match        https://purpleport.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // === CONSTANTS ===
    const ACCESS_FILE_URL = `https://gist.githubusercontent.com/irenemuse96/6cc526d87b5a631d71fcdf9c40e78cfe/raw/gistfile1.txt`;
    const SITE_BASE_URL = 'https://purpleport.com/';
    const SITE = 'purpleport';
    const PHOTOGRPAPHER_SEARCH_FILTER_TYPE_VALUE = '1';
    const MINIMAL_SEARCH_RESULT_NAVIGATION_BUTTONS_AMOUNT = 2;
    const PROCESSING_COLOR = 'b18ccc';
    const RUN_COLOR = '2ecc71';
    const RUN_PROCESSING_TEXT = `▶ Run`;
    const RUN_PAUSE_PROCESSING_TEXT = `⏸ Pause`;
    const RESUME_PROCESSING_TEXT = `▶ Resume`;
    const SAVE_TEXT = '💾';
    const ACTIVE_STYLE_CLASS_NAME = 'active';
    const SCALE_SPEED = 1;
    const DEFAULT_DELAY = 1000 / SCALE_SPEED;
    const PROFILE_MESSAGE_SEND_DELAY_FROM_MS = 180_000 / SCALE_SPEED;
    const PROFILE_MESSAGE_SEND_DELAY_TO_MS = 190_000 / SCALE_SPEED;
    const LS_PROGRESS_STATE_KEY = 'progress';
    const LS_PROGRESS_PHOTOGRAPHERS_SENT_TIMESTAMPS_KEY = 'photographers_sent_timestamps';
    const LS_PROGRESS_HISTORY_KEY = 'history';
    const LS_BLACKLIST_KEY = 'photographers_blacklist';
    const DEFAULT_CITY = 'your city';
    const MAX_MESSAGES_PER_DAY = 1;
    const HISTORY_FILENAME = `history_${getTodayString()}.csv`;
    const DEFAULT_SUBJECT_TEMPLATE = 'Collaboration proposal';
    const LS_SUBJECT_TEMPLATE_KEY = 'photographers_subject_template';
    const LS_BODY_TEMPLATE_KEY = 'photographers_body_template';
    const PORTFOLIOS_PHOTOGRAPHER_PATH_PART_LENGTH = '/portfolio/'.length;
    const MAX_LAST_SENT_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

    // === TEST CONFIGURATION ===
    const AUTOMATION_MODE = Object.freeze({
        DRY_RUN: 'DRY_RUN',
        PREPARE_ONLY: 'PREPARE_ONLY',
        AUTO_SEND: 'AUTO_SEND'
    });

    // Keep PREPARE_ONLY while testing. AUTO_SEND is intentionally blocked
    // until a reliable PurplePort success selector is configured.
    const TEST_CONFIG = Object.freeze({
        mode: AUTOMATION_MODE.PREPARE_ONLY,
        maxPreparedProfilesPerRun: 1,
        elementTimeoutMs: 15_000,
        enableAutomaticSend: false,
        stopOnUncertainResult: true
    });

    const RESULT_STATUS = Object.freeze({
        PREPARED: 'prepared',
        SENT: 'sent',
        SKIPPED: 'skipped',
        FAILED: 'failed',
        UNCERTAIN: 'uncertain'
    });

    const STYLE = document.createElement('style');
    STYLE.textContent = `
        .floating-btn {
          background: #${PROCESSING_COLOR};
          color: white;
          border: 1px solid #8b8bab;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-weight: bold;
          transition: background 0.2s ease;
          z-index: 9999;
          position: fixed;
          right: 15px;
          margin-top: 5px;
          padding: 7px;
        }
        .floating-btn.active {
          background: #${RUN_COLOR};
          animation: pulse 1s infinite alternate;
        }
        @keyframes pulse {0%{transform:scale(1);} 100% {transform:scale(1.05);}}
        .floating-container {
            position: fixed;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 4px;
            border: 1px solid #dadada;
            padding: 8px 12px;
            box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25);
            font-family: 'Open Sans', Verdana, Arial, Helvetica, sans-serif;
            color: white;
            width: 295px;
            background-color: #f0f0f9;
        }
        .floating-container .collapse-btn {
            position: absolute;
            top: -5px;
            right: -5px;
            cursor: pointer;
            background: none;
            border: none;
            color: #8b8bab;
            font-size: 24px;
            line-height: 1;
        }
        .floating-container.collapsed {
            width: 28px;
        }
        .floating-container.collapsed .form-content {
            display: none;
        }
        .floating-input {
            display: flex;
            flex-direction: column;
            gap: 4px;
            color: #8b64bb;
            width: 100%;
        }
        .floating-input span {
          font-weight: 600;
          font-size: 13px;
          margin-top: 5px;
        }
        .floating-input input,
        .floating-input textarea {
            width: 100%;
            background-color: white;
            color: black;
            border: 1px solid #888;
            padding: 6px 8px;
            font-size: 14px;
            font-family: 'Fira Sans';
            resize: vertical;
            box-sizing: border-box;
        }
        .floating-input textarea {
          min-height: 200px;
        }
        `;
    document.head.appendChild(STYLE);

    // === UI VARIABLES ===
    let uploadButton;
    let runPauseButton;
    let sentTodayLabel;
    let downloadButton;
    let messageSubjectField;
    let messageBodyField;
    let diagnosticsButton;

    // === CORE VARIABLES ===
    let username;
    let accessGranted = false;
    let isRunning = false;
    let firstSearchUrl = null;
    let city = DEFAULT_CITY;
    let dates = '1–6 February';
    let instagram = 'https://www.instagram.com/schastlivaia987/?hl=en';
    let email = 'vschastlivaya@gmail.com';
    let name = 'V.';
    const DEFAULT_BODY_TEMPLATE = `Hello {username}\nThis isn’t spam — just a friendly invitation to explore my portfolio.\nI’ll be in {city} ${dates}.\nI’m comfortable posing from portrait to art nude.\nPlease check my portfolio.\nWould you like to shoot together?\nEmail is ${email}\nInsta: ${instagram}\n\nBest regards\n${name}`;
    let page = null;
    let photographers = {};
    let history = {};
    let blacklist = [];

    // === UI ===
    function prepareView() {
        const restoredProgress = restoreSavedProgress();
        if (restoredProgress) prepareRestoredProgressState(restoredProgress);
        let bottom = 85;
        ensureMessageTemplateFields(bottom);
        if (!uploadButton) {
            uploadButton = createUploadButton(`${bottom}px`);
        }
        if (!runPauseButton) {
            let buttonText = canContinue() ? RUN_PAUSE_PROCESSING_TEXT : RUN_PROCESSING_TEXT;
            runPauseButton = createRunPauseButton(buttonText, `${bottom}px`)
            if (isRunning) {
                runPauseButton.classList.add(ACTIVE_STYLE_CLASS_NAME);
                runPauseButton.textContent = RUN_PAUSE_PROCESSING_TEXT;
            }
            runPauseButton.onclick = () => {
                if (!canContinue()) {
                    startProcessing();
                } else {
                    stopProcessing();
                }
            };
        }
        if (!sentTodayLabel) {
            sentTodayLabel = createSentTodayLabel(`${bottom}px`);
        }
        updateSentTodayLabel();
        if (!downloadButton) {
            downloadButton = createDownloadButton(`${bottom}px`);
            downloadButton.onclick = async () => {
                if (!historyLength()) {
                    alert('No history data to download!');
                    return;
                }
                logWithTimestamp(`💾 Downloading file: ${HISTORY_FILENAME}`);
                let historyFileContent = Object
                    .entries(history)
                    .map(([k, v]) => {
                        const keyParts = k.split('_');
                        const today = keyParts[0];
                        const username = keyParts[1];
                        const city = keyParts[2];
                        return `${v.number},${today},${username},${city},${v.messagesToday}`;
                    })
                    .join('\n');
                downloadCsv(HISTORY_FILENAME, historyFileContent);
            }
        }
        if (!diagnosticsButton) {
            diagnosticsButton = createDiagnosticsButton(`${bottom + 40}px`);
            diagnosticsButton.onclick = runQuickDiagnostics;
        }
        if (restoredProgress) {
            isRunning = false;
            if (runPauseButton) {
                runPauseButton.classList.remove(ACTIVE_STYLE_CLASS_NAME);
                runPauseButton.textContent = RESUME_PROCESSING_TEXT;
            }
            logWithTimestamp('Progress restored in paused mode. Press Resume manually.');
        }
    }

    function ensureMessageTemplateFields(bottomPx) {
        if (messageSubjectField && messageBodyField) return;

        const container = document.createElement('div');
        container.className = 'floating-container';
        container.style.bottom = `${bottomPx + 40}px`;
        container.style.right = '10px';

        const collapseButton = document.createElement('button');
        collapseButton.textContent = '−';
        collapseButton.className = 'collapse-btn';

        const formContent = document.createElement('div');
        formContent.className = 'form-content';

        collapseButton.onclick = (e) => {
            e.preventDefault();
            container.classList.toggle('collapsed');
            collapseButton.textContent = container.classList.contains('collapsed') ? '+' : '−';
        };

        messageSubjectField = createField({labelText: 'Title'});
        messageSubjectField.value = loadTemplate(LS_SUBJECT_TEMPLATE_KEY, DEFAULT_SUBJECT_TEMPLATE);
        messageSubjectField.addEventListener('input', () => persistTemplate(LS_SUBJECT_TEMPLATE_KEY, messageSubjectField.value));

        messageBodyField = createField({labelText: 'Text', multiline: true});
        messageBodyField.value = loadTemplate(LS_BODY_TEMPLATE_KEY, DEFAULT_BODY_TEMPLATE);
        messageBodyField.addEventListener('input', () => persistTemplate(LS_BODY_TEMPLATE_KEY, messageBodyField.value));

        formContent.appendChild(messageSubjectField.parentElement);
        formContent.appendChild(messageBodyField.parentElement);

        container.appendChild(collapseButton);
        container.appendChild(formContent);

        document.body.appendChild(container);
    }

    function createField({labelText, multiline = false}) {
        const container = document.createElement('label');
        container.className = 'floating-input';
        const label = document.createElement('span');
        label.textContent = labelText;
        const field = multiline ? document.createElement('textarea') : document.createElement('input');
        field.placeholder = labelText;
        container.appendChild(label);
        container.appendChild(field);
        return field;
    }

    function createUploadButton(bottom) {
        const uploadButton = document.createElement('button');
        uploadButton.textContent = '🚫';
        uploadButton.className = 'floating-btn';
        uploadButton.style.bottom = bottom;
        uploadButton.style.right = '77px';
        uploadButton.style.paddingLeft = '5px';
        uploadButton.style.paddingRight = '5px';
        uploadButton.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (e) => {
                    const csv = e.target.result;
                    blacklist = csv
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length)
                        .map(line => line.endsWith('/') ? line : line + '/')
                        .map(line => line.split('/'))
                        .map(parts => `${parts.at(-2)}`)
                        .filter(line => line);
                    localStorage.setItem(LS_BLACKLIST_KEY, JSON.stringify(blacklist));
                    let message = `Uploaded blacklist with ${blacklist.length} photographers`;
                    alert(message);
                    logWithTimestamp(message);
                };
                reader.readAsText(file);
            };
            input.click();
        };
        document.body.appendChild(uploadButton);
        return uploadButton;
    }

    function createRunPauseButton(label, bottom, show = true) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.className = 'floating-btn';
        btn.style.bottom = bottom;
        btn.style.right = '110px';
        if (!show) btn.style.display = 'none';
        document.body.appendChild(btn);
        return btn;
    }

    function createSentTodayLabel(bottom) {
        const label = document.createElement('div');
        label.className = 'floating-btn';
        label.style.bottom = bottom;
        label.style.right = '40px';
        label.style.pointerEvents = 'none';
        document.body.appendChild(label);
        return label;
    }

    function createDownloadButton(bottom) {
        const downloadButton = document.createElement('button');
        downloadButton.textContent = SAVE_TEXT;
        downloadButton.className = 'floating-btn';
        downloadButton.style.bottom = bottom;
        downloadButton.style.right = '10px';
        downloadButton.style.paddingLeft = '5px';
        downloadButton.style.paddingRight = '5px';
        document.body.appendChild(downloadButton);
        return downloadButton;
    }

    function createDiagnosticsButton(bottom) {
        const button = document.createElement('button');
        button.textContent = '🧪 Quick Test';
        button.className = 'floating-btn';
        button.style.bottom = bottom;
        button.style.right = '10px';
        button.style.width = '110px';
        button.title = 'Checks profiles and message form without sending anything';
        document.body.appendChild(button);
        return button;
    }

    // === CORE ===
    async function checkAccess() {
        const usernameContainer = await getOne('a[title="See your portfolio"]');
        if (!usernameContainer) {
            warnWithTimestamp('Cannot find username container');
            isRunning = false;
            accessGranted = false;
            return;
        }
        const usernameUrl = new URL(usernameContainer.href, location.origin);
        username = usernameUrl.pathname.split('/').filter(Boolean).at(-1);
        logWithTimestamp(`Found the username=${username}`);
        logWithTimestamp('Getting a config ...')
        try {
            const config = await loadConfig();
            logWithTimestamp(`Config is got: ${JSON.stringify(config)}`)
            let accessAvailable = config.users[SITE][username];
            if (!accessAvailable) {
                let message = 'Access not granted!';
                warnWithTimestamp(message);
                alert(message)
                isRunning = false;
                accessGranted = false;
                return;
            }
            logWithTimestamp('Access is granted!')
            accessGranted = true;
            if (!runPauseButton) {
                prepareView();
            }
        } catch (e) {
            let message = 'Cannot get config';
            warnWithTimestamp(message);
            alert(message);
        }
    }

    function loadConfig() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: `${ACCESS_FILE_URL}?${Date.now()}`,
                onload: response => {
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: reject
            });
        });
    }

    async function startProcessing() {
        if (!location.href.includes('search/') && !location.href.includes('?') || !location.href.includes('type=' + PHOTOGRPAPHER_SEARCH_FILTER_TYPE_VALUE)) {
            warnWithTimestamp('No photographers searched');
            alert('Search some photographers!')
            return;
        }
        isRunning = true;
        runPauseButton.classList.add(ACTIVE_STYLE_CLASS_NAME);
        runPauseButton.textContent = RUN_PAUSE_PROCESSING_TEXT;
        let today = getTodayString();
        let historyValue = history[historyKey(today)];
        if (!firstSearchUrl || !previousSearch() || !historyValue) {
            page = 0;
            firstSearchUrl = location.href;
            const locationValue = new URL(firstSearchUrl).searchParams.get('location');
            city = locationValue ? locationValue.split(', ')[0].trim() : DEFAULT_CITY;
            historyValue = history[historyKey(today)];
            if (!historyValue) {
                history[historyKey(today)] = {
                    number: historyLength() + 1,
                    username: username,
                    city: city,
                    messagesToday: 0
                };
            }
            saveProgress();
        }
        let finished;
        do {
            finished = await continueProcessingIfNeeded();
        } while (!finished);
    }

    function stopProcessing() {
        isRunning = false;
        runPauseButton.classList.remove(ACTIVE_STYLE_CLASS_NAME);
        runPauseButton.textContent = RESUME_PROCESSING_TEXT;
        saveProgress();
    }

    function canContinue() {
        return isRunning && accessGranted;
    }

    async function continueProcessingIfNeeded() {
        if (canContinue()) {
            const todayMaxMessagesReached = await sendGreetingMessages();
            if (todayMaxMessagesReached) {
                logWithTimestamp(`Today max messages reached: ${MAX_MESSAGES_PER_DAY}`);
                stopProcessing();
                return true;
            }
        }
        if (canContinue()) {
            const lastPageReached = await openPhotographersNextPage();
            if (lastPageReached) {
                logWithTimestamp(`Last page reached}`);
                stopProcessing();
                return true;
            }
        }
        return false;
    }

    function saveProgress() {
        try {
            let state = {
                isRunning: canContinue(),
                firstSearchUrl: firstSearchUrl,
                city: city,
                page: page,
            };
            let stringState = JSON.stringify(state);
            localStorage.setItem(LS_PROGRESS_STATE_KEY, stringState);
            localStorage.setItem(LS_PROGRESS_PHOTOGRAPHERS_SENT_TIMESTAMPS_KEY, JSON.stringify(photographers));
            localStorage.setItem(LS_PROGRESS_HISTORY_KEY, JSON.stringify(history));
            logWithTimestamp(`💾 Saved progress with the ${(photographersLength())} photographers, ${historyLength()} history and the state: ${stringState}`);
        } catch (e) {
            warnWithTimestamp('⚠️ Progress saving failed due to: %s', e);
        }
    }

    function restoreSavedProgress() {
        const stateData = localStorage.getItem(LS_PROGRESS_STATE_KEY);
        const photographersData = localStorage.getItem(LS_PROGRESS_PHOTOGRAPHERS_SENT_TIMESTAMPS_KEY);
        const historyData = localStorage.getItem(LS_PROGRESS_HISTORY_KEY);
        const blacklistData = localStorage.getItem(LS_BLACKLIST_KEY);
        if (!stateData || !photographersData || !historyData) return null;
        try {
            return {
                state: JSON.parse(stateData),
                photographers: JSON.parse(photographersData),
                history: JSON.parse(historyData),
                blacklist: JSON.parse(blacklistData || '[]')
            };
        } catch (e) {
            warnWithTimestamp(`⚠️ Cannot restore saved progress due to: ${e}`)
            return null;
        }
    }

    function prepareRestoredProgressState(progress) {
        if (progress) {
            const restoredProgressState = progress.state;
            // Never resume automatically after reload in the test build.
            isRunning = false;
            firstSearchUrl = restoredProgressState.firstSearchUrl;
            city = restoredProgressState.city;
            page = restoredProgressState.page;
            photographers = progress.photographers;
            history = progress.history;
            blacklist = progress.blacklist || [];
            logWithTimestamp(`Restored ${(photographersLength())}, ${historyLength()} history and the state: ${JSON.stringify(restoredProgressState)}`);
        }
    }

    // ===  BUSINESS LOGIC ===
    function previousSearch() {
        return removePageParam(firstSearchUrl) === removePageParam(location.href);
    }

    async function openPhotographersNextPage() {
        page++;
        saveProgress();
        let pagesNavigation = await getAll('div#searchResults span.interactions.pageLinks > a');
        if (MINIMAL_SEARCH_RESULT_NAVIGATION_BUTTONS_AMOUNT === pagesNavigation.length / 2) {
            logWithTimestamp(`Only one page in the current search: ${firstSearchUrl}`);
            return true;
        }
        let lastNavigaton = pagesNavigation[pagesNavigation.length - 1];
        let lastNavigationText = lastNavigaton.textContent.trim();
        if ('Next' === lastNavigationText) {
            logWithTimestamp(`Opening the page ${page}`)
            lastNavigaton.click();
            await delay(3 * DEFAULT_DELAY);
            return false;
        } else {
            return true;
        }
    }

    async function sendGreetingMessages() {
        const photographersContainers = await getAll('div.item > div.thumb > div.name');
        logWithTimestamp(`Opened page ${page}. Found ${photographersContainers.length} profile containers.`);

        const todayTime = Date.now();
        const todayString = getTodayString();
        const currentHistory = history[historyKey(todayString)];
        let messagesToday = currentHistory ? currentHistory.messagesToday : 0;
        let preparedThisRun = 0;

        for (const photographersContainer of photographersContainers) {
            if (!canContinue()) {
                logWithTimestamp('Processing stopped before the next profile.');
                return false;
            }

            if (getTodaySentMessages() >= MAX_MESSAGES_PER_DAY) {
                return true;
            }

            const profile = getProfileData(photographersContainer);
            if (!profile) {
                warnWithTimestamp('Skipped a container because a valid portfolio link was not found.');
                continue;
            }

            if (blacklist.includes(profile.profileKey)) {
                logWithTimestamp(`Profile blacklisted: ${profile.profileUrl}`);
                continue;
            }

            if (photographers[profile.profileKey] && todayTime < photographers[profile.profileKey] + MAX_LAST_SENT_DELAY_MS) {
                logWithTimestamp(`Profile skipped because repeat delay has not expired: ${profile.profileUrl}`);
                continue;
            }

            const result = await sendGreetingMessage(profile);
            logWithTimestamp(`Profile result: ${JSON.stringify(result)}`);

            if (result.status === RESULT_STATUS.SENT) {
                messagesToday += 1;
                photographers[profile.profileKey] = Date.now();
                history[historyKey(todayString)].messagesToday = messagesToday;
                updateSentTodayLabel();
                saveProgress();
                await delay(randomIntInRange(PROFILE_MESSAGE_SEND_DELAY_FROM_MS, PROFILE_MESSAGE_SEND_DELAY_TO_MS));
            } else if (result.status === RESULT_STATUS.PREPARED) {
                preparedThisRun += 1;
                logWithTimestamp('Message prepared only. It was NOT sent and was NOT added to sent history.');

                if (preparedThisRun >= TEST_CONFIG.maxPreparedProfilesPerRun) {
                    logWithTimestamp(`Test limit reached: ${TEST_CONFIG.maxPreparedProfilesPerRun} prepared profile(s).`);
                    stopProcessing();
                    return true;
                }
            } else if (result.status === RESULT_STATUS.UNCERTAIN && TEST_CONFIG.stopOnUncertainResult) {
                warnWithTimestamp('Uncertain send result. Stopping for manual verification.');
                stopProcessing();
                return true;
            }
        }

        logWithTimestamp(`${messagesToday} confirmed messages sent today (${getTodayString()}).`);
        saveProgress();
        return false;
    }

    function getProfileData(container) {
        if (!(container instanceof Element)) return null;

        const links = [
            ...container.querySelectorAll('a[href*="/portfolio/"]')
        ];

        const profileLink = links[0];
        const nameLink = links.find(
            link => link.textContent?.trim().length > 0
        );

        if (!(profileLink instanceof HTMLAnchorElement) || !profileLink.href) {
            return null;
        }

        try {
            const url = new URL(profileLink.href, location.origin);
            url.search = '';
            url.hash = '';

            const parts = url.pathname.split('/').filter(Boolean);
            const profileKey = parts.at(-1);
            if (!profileKey) return null;

            return {
                link: profileLink,
                profileKey,
                profileUrl: `${url.origin}${url.pathname}`,
                displayName: nameLink?.textContent?.trim() || profileKey
            };
        } catch (error) {
            warnWithTimestamp(`Invalid profile URL: ${error}`);
            return null;
        }
    }

    async function sendGreetingMessage(profile) {
        const baseResult = {
            profileKey: profile.profileKey,
            profileUrl: profile.profileUrl,
            timestamp: new Date().toISOString()
        };

        if (TEST_CONFIG.mode === AUTOMATION_MODE.DRY_RUN) {
            return {
                ...baseResult,
                status: RESULT_STATUS.PREPARED,
                stage: 'dry_run',
                reason: 'Profile validated; message form was not opened.'
            };
        }

        if (typeof unsafeWindow.SendMessage !== 'function') {
            return {
                ...baseResult,
                status: RESULT_STATUS.FAILED,
                stage: 'open_form',
                reason: 'unsafeWindow.SendMessage is unavailable.'
            };
        }

        unsafeWindow.SendMessage(profile.profileKey, profile.displayName);

        const subjectInput = await waitForElement('input#subject');
        const bodyInputFrame = await waitForElement('iframe#messagecontent_ifr');
        const sendMessageButton = await waitForElement('a#b0');

        if (!subjectInput || !bodyInputFrame || !sendMessageButton) {
            return {
                ...baseResult,
                status: RESULT_STATUS.FAILED,
                stage: 'load_form',
                reason: 'Message form is incomplete.',
                details: {
                    subjectFound: Boolean(subjectInput),
                    frameFound: Boolean(bodyInputFrame),
                    sendButtonFound: Boolean(sendMessageButton)
                }
            };
        }

        const subject = greetingMessageSubject(profile.displayName);
        const body = greetingMessageBody(profile.displayName);
        const subjectFilled = setInputValue(subjectInput, subject);
        const bodyFilled = fillMessageFrame(bodyInputFrame, body);

        if (!subjectFilled || !bodyFilled) {
            return {
                ...baseResult,
                status: RESULT_STATUS.FAILED,
                stage: 'fill_form',
                reason: 'Subject or body could not be filled.'
            };
        }

        logWithTimestamp(`Prepared message for ${profile.displayName}. Automatic sending is disabled.`);
        console.table({
            mode: TEST_CONFIG.mode,
            recipient: profile.displayName,
            profileKey: profile.profileKey,
            subject,
            bodyPreview: body.slice(0, 160),
            sendButtonFound: Boolean(sendMessageButton)
        });

        if (TEST_CONFIG.mode === AUTOMATION_MODE.PREPARE_ONLY || !TEST_CONFIG.enableAutomaticSend) {
            return {
                ...baseResult,
                status: RESULT_STATUS.PREPARED,
                stage: 'prepare_only',
                reason: 'Form filled; press Send manually after inspection.'
            };
        }

        // Safety gate: automatic send must remain unavailable until a reliable
        // PurplePort confirmation signal is implemented and tested manually.
        return {
            ...baseResult,
            status: RESULT_STATUS.UNCERTAIN,
            stage: 'auto_send_blocked',
            reason: 'AUTO_SEND blocked: no reliable send confirmation configured.'
        };
    }

    async function waitForElement(selector, timeoutMs = TEST_CONFIG.elementTimeoutMs) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const element = document.querySelector(selector);
            if (element) return element;
            await delay(250);
        }
        return null;
    }

    function setInputValue(input, value) {
        if (!(input instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
        input.dispatchEvent(new Event('blur', {bubbles: true}));
        return input.value === value;
    }

    function fillMessageFrame(frame, message) {
        if (!(frame instanceof HTMLIFrameElement)) return false;
        const frameDocument = frame.contentDocument;
        const body = frameDocument?.body;
        if (!body) return false;

        body.replaceChildren();
        for (const line of message.split('\n')) {
            const paragraph = frameDocument.createElement('p');
            paragraph.textContent = line || '\u00A0';
            body.appendChild(paragraph);
        }
        body.dispatchEvent(new Event('input', {bubbles: true}));
        body.dispatchEvent(new Event('change', {bubbles: true}));
        return body.innerText.trim().length > 0;
    }

    function greetingMessageSubject(targetUsername) {
        const template = resolveTemplate(messageSubjectField, LS_SUBJECT_TEMPLATE_KEY, DEFAULT_SUBJECT_TEMPLATE);
        return fillTemplate(template, templateContext(targetUsername));
    }

    function greetingMessageBody(targetUsername) {
        const template = resolveTemplate(messageBodyField, LS_BODY_TEMPLATE_KEY, DEFAULT_BODY_TEMPLATE);
        return fillTemplate(template, templateContext(targetUsername));
    }

    function templateContext(targetUsername) {
        return {
            username: targetUsername || '',
            city: city || DEFAULT_CITY,
            dates: dates,
            instagram: instagram,
            email: email,
            name: name
        };
    }

    function fillTemplate(template, context) {
        if (!template) return '';
        return template.replace(/\{(\w+)\}/g, (match, key) => {
            const replacement = context[key];
            return typeof replacement === 'undefined' ? '' : replacement;
        });
    }

    function resolveTemplate(field, storageKey, fallback) {
        const fieldValue = field && field.value && field.value.trim();
        if (fieldValue) {
            return fieldValue;
        }
        const storedValue = localStorage.getItem(storageKey);
        if (storedValue && storedValue.trim()) {
            return storedValue;
        }
        return fallback;
    }

    function loadTemplate(storageKey, fallback) {
        const storedValue = localStorage.getItem(storageKey);
        if (storedValue === null) {
            localStorage.setItem(storageKey, fallback);
            return fallback;
        }
        return storedValue;
    }

    function persistTemplate(storageKey, value) {
        localStorage.setItem(storageKey, value || '');
    }

    function removePageParam(urlString) {
        const url = new URL(urlString);
        url.searchParams.delete('page');
        return url.toString();
    }

    function getTodaySentMessages() {
        const today = getTodayString();
        return Object.keys(history)
            .filter(key => key.startsWith(today))
            .reduce((total, key) => total + history[key].messagesToday, 0);
    }

    function updateSentTodayLabel() {
        if (sentTodayLabel) {
            sentTodayLabel.textContent = `${getTodaySentMessages()}`;
        }
    }

    function photographersLength() {
        return Object.keys(photographers).length;
    }

    function historyKey(today) {
        return `${today}_${username}_${city}`;
    }

    function historyLength() {
        return Object.keys(history).length;
    }

    // === FILE HANDLING ===
    function downloadCsv(filename, text) {
        const blob = new Blob([text], {type: 'text/csv;charset=utf-8;'});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
    }

    // === HELPERS ===
    function logWithTimestamp(template, ...args) {
        const timestamp = toLocalTime(new Date());
        const formattedMessage = formatString(template, ...args);
        console.log(`[${timestamp}] ${formattedMessage}`);
    }

    function warnWithTimestamp(template, ...args) {
        const timestamp = toLocalTime(new Date());
        const formattedMessage = formatString(template, ...args);
        console.warn(`[${timestamp}] ${formattedMessage}`);
    }

    function toLocalTime(date) {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
        return `${hours}:${minutes}:${seconds}.${milliseconds}`;
    }

    function formatString(template, ...args) {
        return template.replace(/%[sd]/g, (match) => {
            if (args.length) {
                if (match === '%d') return parseInt(args.shift(), 10);
                if (match === '%s') return String(args.shift());
            }
            return match;
        });
    }

    function randomIntInRange(min, max) {
        return Math.floor(Math.random() * (max - min)) + min;
    }

    function delay(ms) {
        return new Promise(res => setTimeout(res, ms));
    }

    function getTodayString() {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async function getOne(selector) {
        let all = await getAll(selector);
        return all ? all[0] : null;
    }

    async function getAll(selector) {
        return getAllWithin(document, selector, 100, randomIntInRange(DEFAULT_DELAY / 2, 10 * DEFAULT_DELAY))
    }

    async function getAllWithin(containerElement, selector, waitStepDelayMs, timeout) {
        let waitingTimeStart = performance.now();
        let foundElements = null;
        do {
            await delay(waitStepDelayMs)
            foundElements = containerElement.querySelectorAll(selector);
        } while (!foundElements.length && (performance.now() < waitingTimeStart + timeout))
        return foundElements;
    }


    // === QUICK DIAGNOSTICS ===
    async function runQuickDiagnostics() {
        const startedAt = performance.now();
        const report = [];
        const addResult = (test, passed, details = '') => {
            report.push({
                test,
                status: passed ? '✅ PASS' : '❌ FAIL',
                details
            });
        };

        console.group('🧪 PurplePort Quick Diagnostics');
        console.info('Nothing will be sent and sent history will not be changed.');

        try {
            addResult(
                'Correct site',
                location.hostname === 'purpleport.com',
                location.href
            );

            addResult(
                'Access granted',
                accessGranted === true,
                `accessGranted=${accessGranted}`
            );

            addResult(
                'Username detected',
                Boolean(username),
                username || 'not found'
            );

            const onSearchPage =
                location.href.includes('search/') &&
                location.href.includes(
                    `type=${PHOTOGRPAPHER_SEARCH_FILTER_TYPE_VALUE}`
                );

            addResult(
                'Photographer search page',
                onSearchPage,
                onSearchPage
                    ? 'Search URL looks valid'
                    : 'Open a photographer search result page first'
            );

            const profileBlocks = [
                ...document.querySelectorAll(
                    'div.item > div.thumb > div.name'
                )
            ];

            addResult(
                'Profile containers',
                profileBlocks.length > 0,
                `found=${profileBlocks.length}`
            );

            const parsedProfiles = profileBlocks
                .map(getProfileData)
                .filter(Boolean);

            addResult(
                'Profile parser',
                profileBlocks.length > 0 &&
                    parsedProfiles.length === profileBlocks.length,
                `parsed=${parsedProfiles.length}/${profileBlocks.length}`
            );

            const invalidProfiles = parsedProfiles.filter(profile =>
                !profile.profileKey ||
                !profile.profileUrl ||
                !profile.displayName
            );

            addResult(
                'Required profile fields',
                invalidProfiles.length === 0,
                `invalid=${invalidProfiles.length}`
            );

            const keys = parsedProfiles.map(profile => profile.profileKey);
            const duplicateKeys = [
                ...new Set(
                    keys.filter((key, index) =>
                        keys.indexOf(key) !== index
                    )
                )
            ];

            addResult(
                'Duplicate profile keys',
                duplicateKeys.length === 0,
                duplicateKeys.length
                    ? duplicateKeys.join(', ')
                    : 'none'
            );

            const urlsWithQuery = parsedProfiles.filter(profile =>
                profile.profileUrl.includes('?') ||
                profile.profileUrl.includes('#')
            );

            addResult(
                'Clean profile URLs',
                urlsWithQuery.length === 0,
                `unclean=${urlsWithQuery.length}`
            );

            const testStorageKey = '__pp_quick_test__';
            let storagePassed = false;

            try {
                localStorage.setItem(testStorageKey, 'ok');
                storagePassed =
                    localStorage.getItem(testStorageKey) === 'ok';
                localStorage.removeItem(testStorageKey);
            } catch (error) {
                console.warn('localStorage test failed', error);
            }

            addResult(
                'localStorage read/write',
                storagePassed,
                storagePassed ? 'working' : 'failed'
            );

            addResult(
                'Automation mode is safe',
                TEST_CONFIG.mode !== AUTOMATION_MODE.AUTO_SEND &&
                    TEST_CONFIG.enableAutomaticSend === false,
                `mode=${TEST_CONFIG.mode}, automaticSend=${TEST_CONFIG.enableAutomaticSend}`
            );

            addResult(
                'SendMessage function',
                typeof unsafeWindow.SendMessage === 'function',
                `type=${typeof unsafeWindow.SendMessage}`
            );

            if (
                parsedProfiles.length &&
                typeof unsafeWindow.SendMessage === 'function'
            ) {
                const firstProfile = parsedProfiles[0];

                console.info(
                    'Opening one message form for diagnostics only:',
                    firstProfile
                );

                unsafeWindow.SendMessage(
                    firstProfile.profileKey,
                    firstProfile.displayName
                );

                const [
                    subjectInput,
                    bodyFrame,
                    sendButton
                ] = await Promise.all([
                    waitForElement('input#subject', 10_000),
                    waitForElement('iframe#messagecontent_ifr', 10_000),
                    waitForElement('a#b0', 10_000)
                ]);

                addResult(
                    'Subject input',
                    Boolean(subjectInput),
                    subjectInput ? 'found' : 'not found'
                );

                addResult(
                    'Message iframe',
                    Boolean(bodyFrame?.contentDocument?.body),
                    bodyFrame?.contentDocument?.body
                        ? 'found and accessible'
                        : 'not found or inaccessible'
                );

                addResult(
                    'Send button',
                    Boolean(sendButton),
                    sendButton ? 'found' : 'not found'
                );

                if (subjectInput && bodyFrame?.contentDocument?.body) {
                    const subject = greetingMessageSubject(
                        firstProfile.displayName
                    );
                    const body = greetingMessageBody(
                        firstProfile.displayName
                    );

                    const subjectFilled =
                        setInputValue(subjectInput, subject);
                    const bodyFilled =
                        fillMessageFrame(bodyFrame, body);

                    addResult(
                        'Subject filling',
                        subjectFilled,
                        subjectFilled
                            ? `length=${subject.length}`
                            : 'failed'
                    );

                    addResult(
                        'Body filling',
                        bodyFilled,
                        bodyFilled
                            ? `length=${body.length}`
                            : 'failed'
                    );

                    const unresolvedVariables = [
                        subject,
                        body
                    ].join('\n').match(/\{[^}]+\}/g) || [];

                    addResult(
                        'Template variables resolved',
                        unresolvedVariables.length === 0,
                        unresolvedVariables.length
                            ? unresolvedVariables.join(', ')
                            : 'all resolved'
                    );
                }
            } else {
                addResult(
                    'Message form diagnostics',
                    false,
                    'Skipped because no profile or SendMessage function is unavailable'
                );
            }
        } catch (error) {
            console.error('Quick diagnostics crashed:', error);
            addResult(
                'Unexpected diagnostics error',
                false,
                error instanceof Error
                    ? error.message
                    : String(error)
            );
        }

        const failures = report.filter(
            item => item.status.includes('FAIL')
        ).length;

        console.table(report);
        console.info(
            `Finished in ${Math.round(performance.now() - startedAt)} ms. ` +
            `${report.length - failures}/${report.length} checks passed.`
        );
        console.info(
            'The message form may remain open for manual inspection. ' +
            'The diagnostic did not click Send.'
        );
        console.groupEnd();

        return report;
    }

    // Makes it possible to run the same diagnostics from DevTools:
    // PPQuickDiagnostics()
    unsafeWindow.PPQuickDiagnostics = runQuickDiagnostics;

    if (location.href.startsWith(SITE_BASE_URL)) {
        checkAccess();
    }

})();

