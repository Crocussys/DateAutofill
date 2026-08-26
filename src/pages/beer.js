let addButtonErrorShown = false;


function dataPars(data) {
    try {
        return JSON.parse(data);
    } catch (_) {}

    const result = [];

    const lines = data
        .replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '')
        .split(/\r?\n/);

    for (const line of lines) {
        const elems = line.trim().split(/\s+/);

        if (elems.length === 1) {
            result.push({
                gtin: elems[0]
            });
        } else if (
            elems.length >= 2 &&
            /^(\d{2})\.(\d{2})\.(\d{4})$/.test(elems[1])
        ) {
            result.push({
                gtin: elems[0],
                date: elems[1]
            });
        } else {
            NotificationService.error(`Неизвестный формат строки: ${line}`);
            return null;
        }
    }

    NotificationService.debug(`Распознано кодов: ${result.length}`);

    return result;
}

function createFile(codes) {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(codes.map(item => [item]));
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    const blob = new Blob(
        [XLSX.write(workbook, { bookType: "xlsx", type: "array", bookSST: true })],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    );
    return new File([blob], "codes.xlsx", { type: blob.type });
}

async function addCodes() {
    const codes = await getDataFromClipboard(dataPars);

    if (!codes) {
        NotificationService.error('Не удалось получить коды из буфера');
        return;
    }

    const rows = document.querySelectorAll('div.DataRow');

    if (rows.length === 0) {
        const success = await addCodesFromFile(codes);

        if (!success) {
            return;
        }
    } else {
        for (const item of codes) {
            const existingRow = await findCodeRow(item.gtin);

            if (existingRow) {
                continue;
            }

            await addCodeFromInput(item);
        }
    }

    await addDates(codes);
    await checkInsertResult(codes);
}

async function findCodeRow(gtin, timeoutMs = 15000) {
    const target = String(gtin).trim();
    const start = Date.now();

    const checkRows = () => {
        const rows = Array.from(document.querySelectorAll('div.DataRow'));

        return rows.find(row => {
            const text = row.textContent.replace(/\s+/g, ' ').trim();

            return text.includes(target);
        }) || null;
    };

    // Сначала несколько раз проверяем текущее положение
    for (let i = 0; i < 10; i++) {
        const row = checkRows();

        if (row) {
            return row;
        }

        await reactSleep(300);
    }

    let lastScroll = -1;

    while (Date.now() - start < timeoutMs) {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const current = window.scrollY;

        if (current >= maxScroll) {
            window.scrollTo({
                top: 0,
                behavior: 'auto'
            });

            await reactSleep(1000);

            const row = checkRows();

            if (row) {
                return row;
            }

            break;
        }

        window.scrollTo({
            top: Math.min(
                current + window.innerHeight * 0.7,
                maxScroll
            ),
            behavior: 'auto'
        });

        await reactSleep(700);

        const row = checkRows();

        if (row) {
            return row;
        }

        if (window.scrollY === lastScroll) {
            break;
        }

        lastScroll = window.scrollY;
    }

    return null;
}

async function addCodesFromFile(codes) {
    const load_file_button = findButtonByText('Загрузить файл', false);

    if (!load_file_button) {
        NotificationService.error('Кнопка "Загрузить файл" не найдена');
        return false;
    }

    if (
        load_file_button.disabled ||
        load_file_button.getAttribute('aria-disabled') === 'true'
    ) {
        NotificationService.error('Сначала введите адрес');
        return false;
    }

    load_file_button.click();
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(createFile(codes.map(item => item.gtin)));

    const input = await waitForFileInput();

    if (!input) {
        NotificationService.error('Input файла не найден');
        return false;
    }

    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const footer = document.getElementsByClassName('CisDialog-Footer')[0];

    const load_button = await waitForButtonByText(footer, 'Загрузить', 5000, false);

    if (!load_button) {
        NotificationService.error('Кнопка "Загрузить" не найдена');
        return false;
    }

    load_button.click();

    const add_button = await waitForButtonByText(footer, 'Добавить', 5000, false);

    if (!add_button) {
        NotificationService.error('Кнопка "Добавить" не найдена');
        return false;
    }

    add_button.click();

    await waitForCodes(codes);

    return true;
}

async function addCodeFromInput(item) {
    const input = await waitForGtinInput();

    if (!input) {
        NotificationService.error('Поле добавления кода не найдено');
        return false;
    }

    setReactInputValue(input, item.gtin);

    const option = await waitForAutocompleteOption(input, item.gtin);

    if (!option || option.multiple) {
        NotificationService.error(`Не найден вариант для ${item.gtin}`);
        return false;
    }

    option.click();

    return true;
}

async function addDates(codes) {
    window.scrollTo(0, 0);

    await reactSleep(1000);

    for (const item of codes) {
        if (!item.date) {
            continue;
        }

        const row = await findCodeRow(item.gtin);

        if (!row) {
            NotificationService.error(`Строка ${item.gtin} не найдена`);
            continue;
        }

        const index = row.dataset.index;
        const input = await waitForInputByName(`codes[${index}].connectDate`, 5000);

        if (!input) {
            NotificationService.error(`Поле даты для ${item.gtin} не найдено`);
            continue;
        }

        setReactInputValue(input, item.date);

        await reactSleep(100);
    }

    window.scrollTo(0, 0);
}

async function checkInsertResult(codes) {
    let gtinSuccess = 0;
    let gtinFailed = [];

    let dateTotal = 0;
    let dateSuccess = 0;
    let dateFailed = [];

    for (const item of codes) {
        const row = await findCodeRow(item.gtin);

        if (row) {
            gtinSuccess++;

            if (item.date) {
                dateTotal++;

                const index = row.dataset.index;
                const input = document.querySelector(`input[name="codes[${index}].connectDate"]`);

                if (input?.value === item.date) {
                    dateSuccess++;
                } else {
                    dateFailed.push(item.gtin);
                }
            }
        } else {
            gtinFailed.push(item.gtin);

            if (item.date) {
                dateTotal++;
                dateFailed.push(item.gtin);
            }
        }
    }

    let message =
        `Коды вставлены!\n` +
        `GTIN: ${gtinSuccess}/${codes.length}`;

    if (dateTotal > 0) {
        message += `\nДаты: ${dateSuccess}/${dateTotal}`;
    }

    if (gtinFailed.length > 0) {
        NotificationService.warn(
            `Не вставлены GTIN (${gtinFailed.length}):\n${gtinFailed.join(', ')}`
        );
    }

    if (dateFailed.length > 0) {
        NotificationService.warn(
            `Не вставлены даты (${dateFailed.length}):\n${dateFailed.join(', ')}`
        );
    }

    if (gtinFailed.length === 0 && dateFailed.length === 0) {
        NotificationService.info(message);
    } else {
        NotificationService.warn(message);
    }
}

function ensureAddButton() {
    if (document.getElementById('add-button')) {
        return true;
    }

    const container = document.querySelector('div.LayoutControlPanel__toolbar');

    if (!container) {
        return false;
    }

    const btn = createButton(addCodes, 'Вставить коды', {}, {
        lockScroll: true,
        operationFlag: 'beerOperationInProgress'
    });

    btn.id = 'add-button';
    btn.style.height = '52px';

    updateButtonState(btn);
    container.appendChild(btn);

    return true;
}

async function init() {
    const container = await waitFor(
        () => document.querySelector('div.LayoutControlPanel__toolbar'),
        10000,
        100
    );

    if (!container) {
        NotificationService.error('Внутренняя ошибка: контейнер для кнопки не найден');
        return;
    }

    ensureAddButton();

    const observer = new MutationObserver(() => {
        ensureAddButton();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}