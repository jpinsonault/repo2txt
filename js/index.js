import { displayDirectoryStructure, getSelectedFiles, formatRepoContents, loadSettings, saveSettings } from './utils.js';

document.addEventListener('DOMContentLoaded', function() {
    lucide.createIcons();
    setupShowMoreInfoButton();
    loadSavedSettings();

    const repoUrlInput = document.getElementById('repoUrl');
    const accessTokenInput = document.getElementById('accessToken');
    if (repoUrlInput) {
        repoUrlInput.addEventListener('input', () => {
            saveSettings({ repoUrl: repoUrlInput.value || '' });
        });
    }
    if (accessTokenInput) {
        accessTokenInput.addEventListener('input', () => {
            saveToken(accessTokenInput.value || '');
        });
    }

    const oneClickButton = document.getElementById('oneClickButton');
    if (oneClickButton) {
        oneClickButton.addEventListener('click', runOneClickFlow);
    }
});

async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) {}

    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) return true;
    } catch (_) {}

    const output = document.getElementById('outputText');
    if (output) {
        output.focus();
        output.select();
    }
    return false;
}

function flashButtonMessage(button, text, timeoutMs = 1800) {
    if (!button) return;
    const original = button.dataset.original || button.innerHTML;
    button.dataset.original = original;
    button.innerHTML = `<i data-lucide="keyboard" class="w-5 h-5 mr-2"></i>${text}`;
    lucide.createIcons();
    setTimeout(() => {
        button.innerHTML = button.dataset.original;
        lucide.createIcons();
    }, timeoutMs);
}

function setButtonBusy(button, busyText = 'Working…') {
    if (!button) return;
    button.dataset.original = button.dataset.original || button.innerHTML;
    button.disabled = true;
    button.classList.add('opacity-70', 'cursor-not-allowed');
    button.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-5 w-5 inline-block" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" fill="none" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4A4 4 0 004 12z"></path>
    </svg>${busyText}`;
    lucide.createIcons();
}

function clearButtonBusy(button, successText) {
    if (!button) return;
    if (successText) {
        button.innerHTML = `<i data-lucide="check" class="w-5 h-5 mr-2"></i>${successText}`;
        lucide.createIcons();
        setTimeout(() => {
            button.innerHTML = button.dataset.original || button.innerText;
            button.disabled = false;
            button.classList.remove('opacity-70', 'cursor-not-allowed');
            lucide.createIcons();
        }, 1200);
    } else {
        button.innerHTML = button.dataset.original || button.innerText;
        button.disabled = false;
        button.classList.remove('opacity-70', 'cursor-not-allowed');
        lucide.createIcons();
    }
}

async function runOneClickFlow() {
    const oneClickButton = document.getElementById('oneClickButton');
    setButtonBusy(oneClickButton, 'Fetching…');

    const repoUrl = document.getElementById('repoUrl').value.trim();
    const accessToken = document.getElementById('accessToken').value.trim();
    const outputText = document.getElementById('outputText');
    outputText.value = '';

    saveToken(accessToken);
    saveSettings({ repoUrl });

    try {
        const { owner, repo, lastString } = parseRepoUrl(repoUrl);
        let refFromUrl = '';
        let pathFromUrl = '';

        if (lastString) {
            const references = await getReferences(owner, repo, accessToken);
            const allRefs = [...references.branches, ...references.tags];
            const matchingRef = allRefs.find(ref => lastString.startsWith(ref));
            if (matchingRef) {
                refFromUrl = matchingRef;
                pathFromUrl = lastString.slice(matchingRef.length + 1);
            } else {
                refFromUrl = lastString;
            }
        }

        const sha = await fetchRepoSha(owner, repo, refFromUrl, pathFromUrl, accessToken);
        const tree = await fetchRepoTree(owner, repo, sha, accessToken);

        displayDirectoryStructure(tree);
        document.getElementById('generateTextButton').style.display = 'flex';
        document.getElementById('downloadZipButton').style.display = 'flex';

        setButtonBusy(oneClickButton, 'Generating…');
        const selectedFiles = getSelectedFiles();
        if (selectedFiles.length === 0) {
            throw new Error('No files selected after applying extension filters.');
        }
        const fileContents = await fetchFileContents(selectedFiles, accessToken);
        const formattedText = formatRepoContents(fileContents);
        outputText.value = formattedText;
        document.getElementById('copyButton').style.display = 'flex';
        document.getElementById('downloadButton').style.display = 'flex';

        setButtonBusy(oneClickButton, 'Copying…');
        const copied = await copyToClipboard(formattedText);

        if (copied) {
            clearButtonBusy(oneClickButton, 'Copied!');
        } else {
            clearButtonBusy(oneClickButton, 'Press Ctrl/Cmd+C');
        }
    } catch (error) {
        console.error('Error in one-click flow:', error);
        clearButtonBusy(oneClickButton);
        outputText.value = `Error in one-click flow: ${error.message}\n\n` +
            "Please ensure:\n" +
            "1. The repository URL is correct and accessible.\n" +
            "2. You have the necessary permissions to access the repository.\n" +
            "3. If it's a private repository, you've provided a valid access token.\n" +
            "4. The specified branch/tag and path (if any) exist in the repository.\n" +
            "5. Your extension filters include at least one file type.";
    }
}

function loadSavedSettings() {
    const settings = loadSettings();

    const legacyToken = localStorage.getItem('githubAccessToken');
    const savedToken = settings.githubAccessToken || legacyToken || '';
    if (savedToken) {
        document.getElementById('accessToken').value = savedToken;
    }

    if (settings.repoUrl) {
        document.getElementById('repoUrl').value = settings.repoUrl;
    }

    const tokenInfo = document.getElementById('tokenInfo');
    const showMoreInfoButton = document.getElementById('showMoreInfo');
    if (settings.tokenInfoOpen) {
        tokenInfo.classList.remove('hidden');
        updateInfoIcon(showMoreInfoButton, tokenInfo);
    }
}

function saveToken(token) {
    if (token) {
        localStorage.setItem('githubAccessToken', token);
        saveSettings({ githubAccessToken: token });
    } else {
        localStorage.removeItem('githubAccessToken');
        saveSettings({ githubAccessToken: '' });
    }
}

document.getElementById('repoForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const repoUrl = document.getElementById('repoUrl').value;
    const accessToken = document.getElementById('accessToken').value;

    saveToken(accessToken);
    saveSettings({ repoUrl });

    const outputText = document.getElementById('outputText');
    outputText.value = '';

    try {
        const { owner, repo, lastString } = parseRepoUrl(repoUrl);
        let refFromUrl = '';
        let pathFromUrl = '';

        if (lastString) {
            const references = await getReferences(owner, repo, accessToken);
            const allRefs = [...references.branches, ...references.tags];
            
            const matchingRef = allRefs.find(ref => lastString.startsWith(ref));
            if (matchingRef) {
                refFromUrl = matchingRef;
                pathFromUrl = lastString.slice(matchingRef.length + 1);
            } else {
                refFromUrl = lastString;
            }
        }

        const sha = await fetchRepoSha(owner, repo, refFromUrl, pathFromUrl, accessToken);
        const tree = await fetchRepoTree(owner, repo, sha, accessToken);

        displayDirectoryStructure(tree);
        document.getElementById('generateTextButton').style.display = 'flex';
        document.getElementById('downloadZipButton').style.display = 'flex';
    } catch (error) {
        console.error('Error fetching repository contents:', error);
        outputText.value = `Error fetching repository contents: ${error.message}\n\n` +
            "Please ensure:\n" +
            "1. The repository URL is correct and accessible.\n" +
            "2. You have the necessary permissions to access the repository.\n" +
            "3. If it's a private repository, you've provided a valid access token.\n" +
            "4. The specified branch/tag and path (if any) exist in the repository.";
    }
});

document.getElementById('generateTextButton').addEventListener('click', async function () {
    const accessToken = document.getElementById('accessToken').value;
    const outputText = document.getElementById('outputText');
    outputText.value = '';

    saveToken(accessToken);

    try {
        const selectedFiles = getSelectedFiles();
        if (selectedFiles.length === 0) {
            throw new Error('No files selected');
        }
        const fileContents = await fetchFileContents(selectedFiles, accessToken);
        const formattedText = formatRepoContents(fileContents);
        outputText.value = formattedText;

        document.getElementById('copyButton').style.display = 'flex';
        document.getElementById('downloadButton').style.display = 'flex';
    } catch (error) {
        console.error('Error generating text file:', error);
        outputText.value = `Error generating text file: ${error.message}\n\n` +
            "Please ensure:\n" +
            "1. You have selected at least one file from the directory structure.\n" +
            "2. Your access token (if provided) is valid and has the necessary permissions.\n" +
            "3. You have a stable internet connection.\n" +
            "4. The GitHub API is accessible and functioning normally.";
    }
});

document.getElementById('downloadZipButton').addEventListener('click', async function () {
    const accessToken = document.getElementById('accessToken').value;

    try {
        const selectedFiles = getSelectedFiles();
        if (selectedFiles.length === 0) {
            throw new Error('No files selected');
        }
        const fileContents = await fetchFileContents(selectedFiles, accessToken);
        await createAndDownloadZip(fileContents);
    } catch (error) {
        console.error('Error generating zip file:', error);
        const outputText = document.getElementById('outputText');
        outputText.value = `Error generating zip file: ${error.message}\n\n` +
            "Please ensure:\n" +
            "1. You have selected at least one file from the directory structure.\n" +
            "2. Your access token (if provided) is valid and has the necessary permissions.\n" +
            "3. You have a stable internet connection.\n" +
            "4. The GitHub API is accessible and functioning normally.";
    }
});

document.getElementById('copyButton').addEventListener('click', async function (e) {
    const text = document.getElementById('outputText').value;
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (!ok) {
        flashButtonMessage(e.currentTarget, 'Press Ctrl/Cmd+C');
    }
});

document.getElementById('downloadButton').addEventListener('click', function () {
    const outputText = document.getElementById('outputText').value;
    if (!outputText.trim()) {
        document.getElementById('outputText').value = 'Error: No content to download. Please generate the text file first.';
        return;
    }
    
    try {
        const blob = new Blob([outputText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'prompt.txt';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    } catch (error) {
        console.error('Error during file download:', error);
        document.getElementById('outputText').value = `Error: Failed to download file. ${error.message}`;
    }
});

function parseRepoUrl(url) {
    url = url.replace(/\/$/, '');
    const urlPattern = /^https:\/\/github\.com\/([^\/]+)\/([^\/]+)(\/tree\/(.+))?$/;
    const match = url.match(urlPattern);
    if (!match) {
        throw new Error('Invalid GitHub repository URL. Please ensure the URL is in the correct format: https://github.com/owner/repo or https://github.com/owner/repo/tree/branch/path');
    }
    return {
        owner: match[1],
        repo: match[2],
        lastString: match[4] || ''
    };
}

async function getReferences(owner, repo, token) {
    const headers = {
        'Accept': 'application/vnd.github+json'
    };
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }

    const [branchesResponse, tagsResponse] = await Promise.all([
        fetch(`https://api.github.com/repos/${owner}/${repo}/git/matching-refs/heads/`, { headers }),
        fetch(`https://api.github.com/repos/${owner}/${repo}/git/matching-refs/tags/`, { headers })
    ]);

    if (!branchesResponse.ok || !tagsResponse.ok) {
        throw new Error('Failed to fetch references');
    }

    const branches = await branchesResponse.json();
    const tags = await tagsResponse.json();

    return {
        branches: branches.map(b => b.ref.split('/').slice(2).join('/')),
        tags: tags.map(t => t.ref.split('/').slice(2).join('/'))
    };
}

async function fetchRepoSha(owner, repo, ref, path, token) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path ? `${path}` : ''}${ref ? `?ref=${ref}` : ''}`;
    const headers = {
        'Accept': 'application/vnd.github.object+json'
    };
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
        await handleFetchError(response);
    }
    const data = await response.json();
    return data.sha;
}

async function fetchRepoTree(owner, repo, sha, token) {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`;
    const headers = {
        'Accept': 'application/vnd.github+json'
    };
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
        await handleFetchError(response);
    }
    const data = await response.json();
    return data.tree;
}

async function handleFetchError(response) {
    let bodyText = '';
    try {
        const clone = response.clone();
        bodyText = await clone.text();
    } catch (e) {
        console.error('Failed to read error response body:', e);
    }

    console.error('GitHub fetch error:', {
        status: response.status,
        statusText: response.statusText,
        body: bodyText
    });

    if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
        throw new Error('GitHub API rate limit exceeded. Please try again later or provide a valid access token to increase your rate limit.');
    }
    if (response.status === 404) {
        throw new Error('Repository, branch, or path not found. Please check that the URL, branch/tag, and path are correct and accessible.');
    }

    let detail = '';

    if (bodyText) {
        try {
            const parsed = JSON.parse(bodyText);
            if (parsed && typeof parsed.message === 'string') {
                detail = parsed.message;
            }
        } catch (_) {
            if (bodyText.length < 500) {
                detail = bodyText;
            }
        }
    }

    let base = `Failed to fetch repository data. Status: ${response.status}`;
    if (response.statusText) {
        base += ` ${response.statusText}`;
    }
    if (detail) {
        base += `. Details: ${detail}`;
    }

    throw new Error(base);
}

async function fetchFileContents(files, token) {
    const headers = {
        'Accept': 'application/vnd.github.v3.raw'
    };
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }
    const contents = await Promise.all(files.map(async file => {
        const response = await fetch(file.url, { headers });
        if (!response.ok) {
            await handleFetchError(response);
        }
        const text = await response.text();
        return { url: file.url, path: file.path, text };
    }));
    return contents;
}

function setupShowMoreInfoButton() {
    const showMoreInfoButton = document.getElementById('showMoreInfo');
    const tokenInfo = document.getElementById('tokenInfo');

    showMoreInfoButton.addEventListener('click', function() {
        tokenInfo.classList.toggle('hidden');
        updateInfoIcon(this, tokenInfo);

        const isOpen = !tokenInfo.classList.contains('hidden');
        saveSettings({ tokenInfoOpen: isOpen });
    });
}

function updateInfoIcon(button, tokenInfo) {
    const icon = button.querySelector('[data-lucide]');
    if (icon) {
        icon.setAttribute('data-lucide', tokenInfo.classList.contains('hidden') ? 'info' : 'x');
        lucide.createIcons();
    }
}

async function createAndDownloadZip(fileContents) {
    const zip = new JSZip();

    fileContents.forEach(file => {
        const filePath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
        zip.file(filePath, file.text);
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'partial_repo.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
