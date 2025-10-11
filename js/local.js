import { displayDirectoryStructure, sortContents, getSelectedFiles, formatRepoContents } from './utils.js';
import { extractZipContents } from './zip-utils.js';

let pathZipMap = {};

document.getElementById('directoryPicker').addEventListener('change', handleDirectorySelection);
document.getElementById('zipPicker').addEventListener('change', handleZipSelection);

async function handleDirectorySelection(event) {
    const files = event.target.files;
    if (files.length === 0) return;

    const gitignoreContent = ['.git/**']
    const tree = [];
    for (let file of files) {
        const filePath = file.webkitRelativePath.startsWith('/') ? file.webkitRelativePath.slice(1) : file.webkitRelativePath;
        tree.push({
            path: filePath,
            type: 'blob',
            urlType: 'directory',
            url: URL.createObjectURL(file),
            size: file.size
        });
        if (file.webkitRelativePath.endsWith('.gitignore')) {
            const gitignoreReader = new FileReader();
            gitignoreReader.onload = function(e) {
                const content = e.target.result;
                const lines = content.split('\n');
                const gitignorePath = file.webkitRelativePath.split('/').slice(0, -1).join('/');
                lines.forEach(line => {
                    line = line.trim();
                    if (line && !line.startsWith('#')) {
                        if (gitignorePath) {
                            gitignoreContent.push(`${gitignorePath}/${line}`);
                        } else {
                            gitignoreContent.push(line);
                        }
                    }
                });
                filterAndDisplayTree(tree, gitignoreContent);
            };
            gitignoreReader.readAsText(file);
        }
    }
    filterAndDisplayTree(tree, gitignoreContent);
}

async function handleZipSelection(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        document.getElementById('directoryPicker').value = '';

        const { tree, gitignoreContent, pathZipMap: extractedPathZipMap } = await extractZipContents(file);
        pathZipMap = extractedPathZipMap;

        try {
            tree.forEach(item => {
                if (item && item.type === 'blob') {
                    const rel = item.path.startsWith('/') ? item.path.slice(1) : item.path;
                    const z = pathZipMap[rel];
                    if (z && typeof z.uncompressedSize === 'number') {
                        item.size = z.uncompressedSize;
                    } else if (z && z._data && typeof z._data.uncompressedSize === 'number') {
                        item.size = z._data.uncompressedSize;
                    }
                }
            });
        } catch (_) {}

        filterAndDisplayTree(tree, gitignoreContent);
    } catch (error) {
        const outputText = document.getElementById('outputText');
        outputText.value = `Error processing zip file: ${error.message}\n\n` +
            "Please ensure:\n" +
            "1. The zip file is not corrupted.\n" +
            "2. The zip file contains text files that can be read.\n" +
            "3. The zip file format is supported (.zip, .rar, .7z).\n";
    }
}

function filterAndDisplayTree(tree, gitignoreContent) {
    const filteredTree = tree.filter(file => !isIgnored(file.path, gitignoreContent));
    filteredTree.sort(sortContents);
    displayDirectoryStructure(filteredTree);
    document.getElementById('generateTextButton').style.display = 'flex';
}

document.getElementById('generateTextButton').addEventListener('click', async function () {
    const outputText = document.getElementById('outputText');
    outputText.value = '';

    try {
        const selectedFiles = getSelectedFiles();
        if (selectedFiles.length === 0) {
            throw new Error('No files selected');
        }
        const fileContents = await fetchFileContents(selectedFiles);
        const formattedText = formatRepoContents(fileContents);
        outputText.value = formattedText;

        document.getElementById('copyButton').style.display = 'flex';
        document.getElementById('downloadButton').style.display = 'flex';
    } catch (error) {
        outputText.value = `Error generating text file: ${error.message}\n\n` +
            "Please ensure:\n" +
            "1. You have selected at least one file from the directory structure.\n" +
            "2. The selected files are accessible and readable.\n" +
            "3. You have sufficient permissions to read the selected files.";
    }
});

async function fetchFileContents(files) {
    const contents = await Promise.all(files.map(async file => {
        if (file.urlType === 'zip') {
            const relativePath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
            const text = await pathZipMap[relativePath].async('text');
            return { url: file.url, path: relativePath, text };
        } else {
            const response = await fetch(file.url);
            if (!response.ok) {
                throw new Error(`Failed to fetch file: ${file.path}`);
            }
            const text = await response.text();
            return { url: file.url, path: file.path, text };
        }
    }));
    return contents;
}

document.addEventListener('DOMContentLoaded', function() {
    lucide.createIcons();
});

function isIgnored(filePath, gitignoreRules) {
    return gitignoreRules.some(rule => {
        try {
            let pattern = rule.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\/$/, '(/.*)?$').replace(/^\//, '^');
            if (!pattern.startsWith('^')) {
                pattern = `(^|/)${pattern}`;
            }
            const regex = new RegExp(pattern);
            return regex.test(filePath);
        } catch (error) {
            console.log('Skipping ignore check for', filePath, 'with rule', rule);
            console.log(error);
            return false;
        }
    });
}

function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text)
            .then(() => console.log('Text copied to clipboard'))
            .catch(err => {
                console.error('Failed to copy text: ', err);
                return false;
            });
    } else {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const success = document.execCommand('copy');
            textArea.remove();
            if (success) {
                console.log('Text copied to clipboard');
                return Promise.resolve();
            } else {
                console.error('Failed to copy text');
                return Promise.reject(new Error('execCommand returned false'));
            }
        } catch (err) {
            console.error('Failed to copy text: ', err);
            return Promise.reject(err);
        }
    }
}

document.getElementById('copyButton').addEventListener('click', function () {
    const outputText = document.getElementById('outputText');
    outputText.select();
    copyToClipboard(outputText.value)
        .catch(err => console.error('Failed to copy text: ', err));
});

document.getElementById('downloadButton').addEventListener('click', function () {
    const outputText = document.getElementById('outputText').value;
    if (!outputText.trim()) {
        document.getElementById('outputText').value = 'Error: No content to download. Please generate the text file first.';
        return;
    }
    const blob = new Blob([outputText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompt.txt';
    a.click();
    URL.revokeObjectURL(url);
});
