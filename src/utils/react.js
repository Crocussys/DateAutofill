const reactSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let userScrollLocked = false;

function setReactInputValue(input, value) {
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    ['input', 'change', 'blur'].forEach(evt =>
        input.dispatchEvent(new Event(evt, { bubbles: true }))
    );
}

function setInputValueWithoutBlur(input, value) {
    if (!input) {
        return;
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function bringIntoView(element, delayMs = 80) {
    if (!element) {
        return;
    }
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    await reactSleep(delayMs);
}

function isMuiInputReady(input) {
    if (!input || input.getClientRects().length === 0) {
        return false;
    }
    const root = input.closest('.MuiFormControl-root') ?? input.parentElement;
    const combobox = root?.querySelector('[role="combobox"]') ?? null;
    if (!combobox || combobox.getClientRects().length === 0) {
        return false;
    }
    if (combobox.getAttribute('aria-disabled') === 'true' || combobox.classList.contains('Mui-disabled')) {
        return false;
    }
    return true;
}

function getInputsByNamePattern(namePrefix, nameSuffix, readyOnly = false, readyCheck = isMuiInputReady) {
    const rows = Array.from(document.querySelectorAll(`input[name^="${namePrefix}"][name$="${nameSuffix}"]`));
    if (!readyOnly) {
        return rows;
    }
    return rows.filter(readyCheck);
}

async function selectMuiOptionByName(inputName, value) {
    const maxAttempts = 60;
    const delayMs = 50;
    const targetValue = String(value);

    const findElements = () => {
        const input = document.querySelector(`input[name="${inputName}"]`);
        if (!input) {
            return { input: null, combobox: null, labelId: null };
        }
        const root = input.closest('.MuiFormControl-root') ?? input.parentElement;
        const combobox = root?.querySelector('[role="combobox"]') ?? null;
        const label = root?.querySelector('label') ?? null;
        return { input, combobox, labelId: label?.id ?? null };
    };

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const { input, combobox, labelId } = findElements();
        if (!input || !combobox) {
            await reactSleep(delayMs);
            continue;
        }
        if (combobox.getAttribute('aria-disabled') === 'true' || combobox.classList.contains('Mui-disabled')) {
            await reactSleep(delayMs);
            continue;
        }

        combobox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        combobox.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        let listbox = null;
        for (let i = 0; i < maxAttempts; i += 1) {
            if (labelId) {
                listbox = document.querySelector(`ul[role="listbox"][aria-labelledby="${labelId}"]`);
            }
            if (!listbox) {
                const listboxes = Array.from(document.querySelectorAll('ul[role="listbox"]'));
                listbox = listboxes.find(ul => ul.querySelector(`li[role="option"][data-value="${targetValue}"]`)) || null;
            }
            if (listbox) break;
            await reactSleep(delayMs);
        }

        if (!listbox) {
            await reactSleep(delayMs);
            continue;
        }

        const option = listbox.querySelector(`li[role="option"][data-value="${targetValue}"]`);
        if (!option) {
            await reactSleep(delayMs);
            continue;
        }
        option.click();

        for (let i = 0; i < maxAttempts; i += 1) {
            const current = document.querySelector(`input[name="${inputName}"]`);
            if (current?.value === targetValue) {
                return true;
            }
            await reactSleep(delayMs);
        }
    }

    NotificationService.warn(`MUI option not found or not set: ${inputName}=${targetValue}`);
    return false;
}

function lockUserScroll() {
    if (userScrollLocked) return;

    userScrollLocked = true;

    window.addEventListener('wheel', preventUserScroll, { passive: false });
    window.addEventListener('touchmove', preventUserScroll, { passive: false });
    window.addEventListener('keydown', preventKeyboardScroll, { passive: false });
}

function unlockUserScroll() {
    if (!userScrollLocked) return;

    userScrollLocked = false;

    window.removeEventListener('wheel', preventUserScroll);
    window.removeEventListener('touchmove', preventUserScroll);
    window.removeEventListener('keydown', preventKeyboardScroll);
}

function preventUserScroll(event) {
    event.preventDefault();
}

function preventKeyboardScroll(event) {
    const keys = [
        'ArrowUp',
        'ArrowDown',
        'PageUp',
        'PageDown',
        'Home',
        'End',
        ' '
    ];

    if (keys.includes(event.key)) {
        event.preventDefault();
    }
}

async function waitFor(check, timeoutMs = 5000, pollMs = 50) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const result = check();

        if (result) {
            return result;
        }

        await reactSleep(pollMs);
    }

    return null;
}

function waitForInputByName(inputName, timeoutMs = 3000) {
    return waitFor(
        () => document.querySelector(`input[name="${inputName}"]`),
        timeoutMs
    );
}

function waitForFileInput(timeoutMs = 5000) {
    return waitFor(
        () => document.querySelector('input[type="file"]'),
        timeoutMs
    );
}

function waitForGtinInput(timeoutMs = 5000) {
    return waitFor(
        () => Array.from(document.querySelectorAll('input'))
            .find(input => !input.name),
        timeoutMs
    );
}

function waitForAutocompleteOption(input, value, timeoutMs = 8000) {
    const targetValue = String(value).trim();

    return waitFor(() => {
        const listboxId =
            input.getAttribute('aria-controls') ||
            input.getAttribute('aria-owns');

        let listbox = listboxId
            ? document.getElementById(listboxId)
            : null;

        if (!listbox) {
            listbox = document.querySelector('ul[role="listbox"]');
        }

        if (!listbox) {
            return null;
        }

        const options = Array.from(
            listbox.querySelectorAll('li[role="option"]')
        );

        const exact = options.find(option => {
            const dataValue =
                option.getAttribute('data-value')?.trim() ?? '';

            const text =
                option.textContent?.trim() ?? '';

            return (
                dataValue === targetValue ||
                text === targetValue
            );
        });

        if (exact) {
            return exact;
        }

        if (options.length === 1) {
            return options[0];
        }

        return null;
    }, timeoutMs);
}

function waitForAutocompleteOptionByValue(
    inputName,
    value,
    timeoutMs = 8000
) {
    const targetValue = String(value).trim();

    return waitFor(() => {
        const input = document.querySelector(
            `input[name="${inputName}"]`
        );

        if (!input) {
            return null;
        }

        const listboxId =
            input.getAttribute('aria-controls') ||
            input.getAttribute('aria-owns');

        let listbox = listboxId
            ? document.getElementById(listboxId)
            : null;

        if (!listbox) {
            listbox = document.querySelector('ul[role="listbox"]');
        }

        if (!listbox) {
            return null;
        }

        const options = Array.from(
            listbox.querySelectorAll('li[role="option"]')
        );

        const exact = options.find(option => {
            const dataValue =
                option.getAttribute('data-value')?.trim() ?? '';

            const label =
                option.textContent?.trim() ?? '';

            return (
                dataValue === targetValue ||
                label === targetValue
            );
        });

        if (exact) {
            return exact;
        }

        if (options.length === 1) {
            return options[0];
        }

        if (options.length > 1) {
            return { multiple: true };
        }

        return null;
    }, timeoutMs);
}

function waitForGtinOption(inputName, gtin, timeoutMs = 8000) {
    return waitForAutocompleteOptionByValue(
        inputName,
        gtin,
        timeoutMs
    );
}

async function waitForCodes(codes, timeoutMs = 10000) {
    const targets = codes.map(
        item => String(item.gtin).trim()
    );

    const result = await waitFor(() => {
        const rows = Array.from(
            document.querySelectorAll('div.DataRow')
        );

        const current = new Set(
            rows
                .map(row => {
                    const cell = row.querySelector(
                        'div.DataCell-Content div.MuiBox-root'
                    );

                    return cell?.textContent?.trim();
                })
                .filter(Boolean)
        );

        return targets.every(gtin => current.has(gtin));
    }, timeoutMs, 100);

    if (!result) {
        NotificationService.warn(
            'Не все коды появились в таблице'
        );

        return false;
    }

    return true;
}

function waitForStableInputByName(
    inputName,
    timeoutMs = 7000,
    stableMs = 200,
    readyCheck = isMuiInputReady
) {
    let candidate = null;
    let stableSince = 0;

    return waitFor(() => {
        const input = document.querySelector(
            `input[name="${inputName}"]`
        );

        if (
            input &&
            readyCheck(input) &&
            input.isConnected
        ) {
            if (input !== candidate) {
                candidate = input;
                stableSince = Date.now();

                return null;
            }

            if (Date.now() - stableSince >= stableMs) {
                return input;
            }
        } else {
            candidate = null;
            stableSince = 0;
        }

        return null;
    }, timeoutMs);
}
