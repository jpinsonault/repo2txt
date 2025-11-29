const SETTINGS_KEY = 'repo2txtSettings';

function loadSettings() {
    try {
        return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch (e) {
        return {};
    }
}

function saveSettings(partial) {
    const current = loadSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...partial }));
}

function displayDirectoryStructure(tree) {
    tree = tree.filter(item => item.type === 'blob').sort(sortContents);
    const container = document.getElementById('directoryStructure');
    container.innerHTML = '';
    const rootUl = document.createElement('ul');
    container.appendChild(rootUl);

    const commonExtensions = ['.js', '.py', '.java', '.cpp', '.html', '.css', '.ts', '.jsx', '.tsx'];
    const directoryStructure = {};
    const extensionCheckboxes = {};
    const sizeCache = new WeakMap();

    const settings = loadSettings();
    const savedExtensionStates = settings.extensionStates || {};
    const showSizeBars = settings.showSizeBars !== false;

    tree.forEach(item => {
        item.path = item.path.startsWith('/') ? item.path : '/' + item.path;
        const pathParts = item.path.split('/');
        let currentLevel = directoryStructure;

        pathParts.forEach((part, index) => {
            part = part === '' ? './' : part;
            if (index === pathParts.length - 1) {
                if (!currentLevel[part]) {
                    const sizeBytes = getInitialSizeBytes(item);
                    currentLevel[part] = { ...item, sizeBytes };
                }
            } else {
                if (!currentLevel[part]) {
                    currentLevel[part] = {};
                }
                currentLevel = currentLevel[part];
            }
        });
    });

    computeAllSizes(directoryStructure);
    ensureSizeControls(showSizeBars);

    const rootEntries = Object.entries(directoryStructure).sort((a, b) => {
        const aSize = getNodeSizeBytes(a[1]);
        const bSize = getNodeSizeBytes(b[1]);
        if (bSize !== aSize) return bSize - aSize;
        const aIsDir = isDirectoryNode(a[1]);
        const bIsDir = isDirectoryNode(b[1]);
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return a[0].localeCompare(b[0]);
    });
    const maxRoot = rootEntries.length ? Math.max(...rootEntries.map(e => getNodeSizeBytes(e[1]))) : 0;

    for (const [name, item] of rootEntries) {
        createTreeNode(name, item, rootUl, maxRoot);
    }

    createExtensionCheckboxesContainer();

    container.addEventListener('change', function(event) {
        if (event.target.type === 'checkbox') {
            updateParentCheckbox(event.target);
            updateExtensionCheckboxes();
            persistExtensionStates();
        }
    });

    function createTreeNode(name, item, parentUl, siblingMax) {
        const li = document.createElement('li');
        li.className = 'my-2';

        const row = document.createElement('div');
        row.className = 'flex items-center flex-wrap gap-1';
        li.appendChild(row);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'mr-2';
        row.appendChild(checkbox);

        if (isDirectoryNode(item)) {
            checkbox.classList.add('directory-checkbox');

            const collapseButton = createCollapseButton();
            row.appendChild(collapseButton);

            appendIcon(row, 'folder');

            const label = document.createElement('span');
            label.textContent = name;
            row.appendChild(label);

            const sizeText = document.createElement('span');
            sizeText.className = 'ml-2 text-xs text-gray-500';
            sizeText.textContent = `(${formatBytes(getNodeSizeBytes(item))})`;
            row.appendChild(sizeText);

            const dirSize = getNodeSizeBytes(item);
            const scaleMax = typeof siblingMax === 'number' && siblingMax > 0 ? siblingMax : dirSize || 1;
            const dirBar = createSizeBar(scalePercent(dirSize, scaleMax), showSizeBars);
            row.appendChild(dirBar);

            const ul = document.createElement('ul');
            ul.className = 'ml-6 mt-2';
            li.appendChild(ul);

            const entries = Object.entries(item).sort((a, b) => {
                const aSize = getNodeSizeBytes(a[1]);
                const bSize = getNodeSizeBytes(b[1]);
                if (bSize !== aSize) return bSize - aSize;
                const aIsDir = isDirectoryNode(a[1]);
                const bIsDir = isDirectoryNode(b[1]);
                if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
                return a[0].localeCompare(b[0]);
            });

            const maxChild = entries.length ? Math.max(...entries.map(e => getNodeSizeBytes(e[1]))) : 0;

            for (const [childName, childItem] of entries) {
                createTreeNode(childName, childItem, ul, maxChild);
            }

            addDirectoryCheckboxListener(checkbox, li);
            addCollapseButtonListener(collapseButton, ul);
        } else {
            const extension = name.split('.').pop().toLowerCase();
            const isCommonFile = commonExtensions.includes('.' + extension);

            let shouldCheck = isCommonFile;
            if (Object.prototype.hasOwnProperty.call(savedExtensionStates, extension)) {
                shouldCheck = !!savedExtensionStates[extension];
            }
            checkbox.checked = shouldCheck;

            try {
                const valueObj = {
                    path: item.path && item.path.startsWith('/') ? item.path.slice(1) : item.path,
                    url: item.url,
                    urlType: item.urlType,
                    type: item.type,
                    size: typeof item.size === 'number' ? item.size : item.sizeBytes
                };
                checkbox.value = JSON.stringify(valueObj);
            } catch (e) {
                console.error('Failed to serialize file item for checkbox value:', item, e);
                checkbox.value = '';
            }

            if (!(extension in extensionCheckboxes)) {
                extensionCheckboxes[extension] = {
                    checkbox: createExtensionCheckbox(extension),
                    children: []
                };
            }
            extensionCheckboxes[extension].children.push(checkbox);

            appendIcon(row, 'file');

            const labelWrap = document.createElement('span');
            labelWrap.textContent = name;
            row.appendChild(labelWrap);

            const sizeText = document.createElement('span');
            sizeText.className = 'ml-2 text-xs text-gray-500';
            sizeText.textContent = `(${formatBytes(item.sizeBytes || 0)})`;
            row.appendChild(sizeText);

            const size = item.sizeBytes || 0;
            const scaleMax = typeof siblingMax === 'number' && siblingMax > 0 ? siblingMax : size || 1;
            const bar = createSizeBar(scalePercent(size, scaleMax), showSizeBars);
            row.appendChild(bar);
        }

        parentUl.appendChild(li);
        updateParentCheckbox(checkbox);
        updateExtensionCheckboxes();
    }

    function createCollapseButton() {
        const collapseButton = document.createElement('button');
        collapseButton.innerHTML = '<i data-lucide="chevron-down" class="w-4 h-4"></i>';
        collapseButton.className = 'mr-1 focus:outline-none';
        return collapseButton;
    }

    function appendIcon(element, iconName) {
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', iconName);
        icon.className = 'inline-block w-4 h-4 mr-1';
        element.appendChild(icon);
    }

    function addDirectoryCheckboxListener(checkbox, li) {
        checkbox.addEventListener('change', function() {
            const childCheckboxes = li.querySelectorAll('ul li > div > input[type="checkbox"]');
            childCheckboxes.forEach(childBox => {
                childBox.checked = this.checked;
                childBox.indeterminate = false;
            });
        });
    }

    function addCollapseButtonListener(collapseButton, ul) {
        collapseButton.addEventListener('click', function() {
            ul.classList.toggle('hidden');
            const icon = this.querySelector('[data-lucide]');
            if (ul.classList.contains('hidden')) {
                icon.setAttribute('data-lucide', 'chevron-right');
            } else {
                icon.setAttribute('data-lucide', 'chevron-down');
            }
            lucide.createIcons();
        });
    }

    function createExtensionCheckbox(extension) {
        const extCheckbox = document.createElement('input');
        extCheckbox.type = 'checkbox';
        extCheckbox.className = 'mr-1';
        extCheckbox.value = extension;
        return extCheckbox;
    }

    function updateParentCheckbox(checkbox) {
        if (!checkbox) return;
        const li = checkbox.closest('li');
        if (!li) return;
        if (!li.parentElement) return;
        const parentLi = li.parentElement.closest('li');
        if (!parentLi) return;

        const parentCheckbox = parentLi.querySelector(':scope > div > input[type="checkbox"]');
        const siblingCheckboxes = parentLi.querySelectorAll(':scope > ul > li > div > input[type="checkbox"]');

        const checkedCount = Array.from(siblingCheckboxes).filter(cb => cb.checked).length;
        const indeterminateCount = Array.from(siblingCheckboxes).filter(cb => cb.indeterminate).length;

        if (indeterminateCount !== 0) {
            parentCheckbox.checked = false;
            parentCheckbox.indeterminate = true;
        } else if (checkedCount === 0) {
            parentCheckbox.checked = false;
            parentCheckbox.indeterminate = false;
        } else if (checkedCount === siblingCheckboxes.length) {
            parentCheckbox.checked = true;
            parentCheckbox.indeterminate = false;
        } else {
            parentCheckbox.checked = false;
            parentCheckbox.indeterminate = true;
        }

        updateParentCheckbox(parentCheckbox);
    }

    function updateExtensionCheckboxes() {
        for (const [extension, checkbox] of Object.entries(extensionCheckboxes)) {
            const children = checkbox.children;
            const checkedCount = Array.from(children).filter(cb => cb.checked).length;

            if (checkedCount === 0) {
                checkbox.checkbox.checked = false;
                checkbox.checkbox.indeterminate = false;
            } else if (checkedCount === children.length) {
                checkbox.checkbox.checked = true;
                checkbox.checkbox.indeterminate = false;
            } else {
                checkbox.checkbox.checked = false;
                checkbox.checkbox.indeterminate = true;
            }
        }
    }

    function persistExtensionStates() {
        const map = {};
        for (const [extension, group] of Object.entries(extensionCheckboxes)) {
            const extCB = group.checkbox;
            if (!extCB.indeterminate) {
                map[extension] = !!extCB.checked;
            }
        }
        saveSettings({ extensionStates: map });
    }

    function createExtensionCheckboxesContainer() {
        const extentionCheckboxesContainer = document.getElementById('extentionCheckboxes');
        extentionCheckboxesContainer.innerHTML = '';
        extentionCheckboxesContainer.className = 'mt-4';

        const extentionCheckboxesContainerLabel = document.createElement('label');
        extentionCheckboxesContainerLabel.innerHTML = 'Filter by file extensions:';
        extentionCheckboxesContainerLabel.className = 'block text-sm font-medium text-gray-600';
        extentionCheckboxesContainer.appendChild(extentionCheckboxesContainerLabel);

        const extentionCheckboxesContainerUl = document.createElement('ul');
        extentionCheckboxesContainer.appendChild(extentionCheckboxesContainerUl);
        extentionCheckboxesContainerUl.className = 'mt-1';

        const sortedExtensions = Object.entries(extensionCheckboxes).sort((a, b) => b[1].children.length - a[1].children.length);
        for (const [extension, checkbox] of sortedExtensions) {
            const extCheckbox = checkbox.checkbox;
            const extCheckboxLi = document.createElement('li');
            extCheckboxLi.className = 'inline-block mr-4';
            extCheckboxLi.appendChild(extCheckbox);
            extCheckboxLi.appendChild(document.createTextNode('.' + extension));
            extentionCheckboxesContainerUl.appendChild(extCheckboxLi);

            if (Object.prototype.hasOwnProperty.call(savedExtensionStates, extension)) {
                extCheckbox.checked = !!savedExtensionStates[extension];
                extCheckbox.indeterminate = false;
            }

            extCheckbox.addEventListener('change', function() {
                const children = checkbox.children;
                children.forEach(child => {
                    child.checked = this.checked;
                    child.indeterminate = false;
                    updateParentCheckbox(child);
                });
                persistExtensionStates();
            });
        }
    }

    function isDirectoryNode(node) {
        return !(node && typeof node.type === 'string');
    }

    function getInitialSizeBytes(item) {
        if (typeof item.size === 'number') return item.size;
        if (typeof item.sizeBytes === 'number') return item.sizeBytes;
        return 0;
    }

    function computeAllSizes(node) {
        if (!node || typeof node !== 'object') return 0;
        if (!isDirectoryNode(node)) {
            const s = node.sizeBytes || 0;
            sizeCache.set(node, s);
            return s;
        }
        let sum = 0;
        for (const child of Object.values(node)) {
            sum += computeAllSizes(child);
        }
        sizeCache.set(node, sum);
        return sum;
    }

    function getNodeSizeBytes(node) {
        if (!node || typeof node !== 'object') return 0;
        const cached = sizeCache.get(node);
        if (typeof cached === 'number') return cached;
        return computeAllSizes(node);
    }

    function formatBytes(n) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        let v = n || 0;
        while (v >= 1024 && i < units.length - 1) {
            v = v / 1024;
            i += 1;
        }
        if (i === 0) return `${v} ${units[i]}`;
        return `${v.toFixed(1)} ${units[i]}`;
    }

    function scalePercent(value, max) {
        if (!max || max <= 0) return 0;
        const pct = (value / max) * 100;
        if (pct > 0 && pct < 2) return 2;
        return Math.max(0, Math.min(100, Math.round(pct)));
    }

    function createSizeBar(percent, visible) {
        const wrap = document.createElement('div');
        wrap.className = 'ml-3 grow max-w-[12rem]';
        const track = document.createElement('div');
        track.className = 'w-full h-2 bg-gray-200 rounded overflow-hidden sizebar';
        if (!visible) track.classList.add('hidden');
        const fill = document.createElement('div');
        fill.className = 'h-2 bg-blue-500';
        fill.style.width = `${percent}%`;
        track.appendChild(fill);
        wrap.appendChild(track);
        return wrap;
    }

    function ensureSizeControls(initial) {
        const host = document.getElementById('extentionCheckboxes');
        const controls = document.createElement('div');
        controls.className = 'mt-3';
        const label = document.createElement('label');
        label.className = 'inline-flex items-center text-sm text-gray-600';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.className = 'mr-2';
        toggle.checked = !!initial;
        label.appendChild(toggle);
        label.appendChild(document.createTextNode('Show size bars'));
        controls.appendChild(label);
        host.appendChild(controls);

        toggle.addEventListener('change', function() {
            const bars = document.querySelectorAll('#directoryStructure .sizebar');
            bars.forEach(el => {
                if (this.checked) el.classList.remove('hidden');
                else el.classList.add('hidden');
            });
            saveSettings({ showSizeBars: this.checked });
        });
    }

    lucide.createIcons();
}

function sortContents(a, b) {
    if (!a || !b || !a.path || !b.path) return 0;
    const aPath = a.path.split('/');
    const bPath = b.path.split('/');
    const minLength = Math.min(aPath.length, bPath.length);

    for (let i = 0; i < minLength; i++) {
        if (aPath[i] !== bPath[i]) {
            if (i === aPath.length - 1 && i < bPath.length - 1) return 1;
            if (i === bPath.length - 1 && i < aPath.length - 1) return -1;
            return aPath[i].localeCompare(bPath[i]);
        }
    }

    return aPath.length - bPath.length;
}

function getSelectedFiles() {
    const checkboxes = document.querySelectorAll('#directoryStructure input[type="checkbox"]:checked:not(.directory-checkbox)');
    const files = [];
    Array.from(checkboxes).forEach(checkbox => {
        const value = checkbox.value;
        if (!value) return;
        try {
            const parsed = JSON.parse(value);
            files.push(parsed);
        } catch (e) {
            console.error('Failed to parse selected file from checkbox value:', value, e);
        }
    });
    return files;
}

function formatRepoContents(contents) {
    let text = '';
    let index = '';

    contents = Array.isArray(contents) ? contents.sort(sortContents) : [contents];

    const tree = {};
    contents.forEach(item => {
        const parts = item.path.split('/');
        let currentLevel = tree;
        parts.forEach((part, i) => {
            if (!currentLevel[part]) {
                currentLevel[part] = i === parts.length - 1 ? null : {};
            }
            currentLevel = currentLevel[part];
        });
    });

    function buildIndex(node, prefix = '') {
        let result = '';
        const entries = Object.entries(node);
        entries.forEach(([name, subNode], index) => {
            const isLastItem = index === entries.length - 1;
            const linePrefix = isLastItem ? '└── ' : '├── ';
            const childPrefix = isLastItem ? '    ' : '│   ';
            name = name === '' ? './' : name;
            result += `${prefix}${linePrefix}${name}\n`;
            if (subNode) {
                result += buildIndex(subNode, `${prefix}${childPrefix}`);
            }
        });
        return result;
    }

    index = buildIndex(tree);

    contents.forEach((item) => {
        text += `\n\n---\nFile: ${item.path}\n---\n\n${item.text}\n`;
    });

    const formattedText = `Directory Structure:\n\n${index}\n${text}`;
    try {
        const { encode } = GPTTokenizer_cl100k_base;
        const tokensCount = encode(formattedText).length;
        document.getElementById('tokenCount').innerHTML = `Approximate Token Count: ${tokensCount} <a href="https://github.com/niieani/gpt-tokenizer" target="_blank" class="text-blue-500 hover:text-blue-700 underline">(Using cl100k_base tokenizer)</a>`;
    } catch (error) {
        document.getElementById('tokenCount').innerHTML = '';
        console.log(error);
    }
    return formattedText;
}

export { displayDirectoryStructure, sortContents, getSelectedFiles, formatRepoContents, loadSettings, saveSettings };
