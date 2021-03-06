/*
 * Copyright (C) 2020  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/* global
 * DictionaryDatabase
 * DictionaryImporter
 * Modal
 * ObjectPropertyAccessor
 * api
 */

class DictionaryImportController {
    constructor(settingsController, storageController) {
        this._settingsController = settingsController;
        this._storageController = storageController;
        this._modifying = false;
        this._purgeButton = null;
        this._purgeConfirmButton = null;
        this._importFileButton = null;
        this._importFileInput = null;
        this._purgeConfirmModal = null;
        this._errorContainer = null;
        this._spinner = null;
        this._purgeNotification = null;
        this._importInfo = null;
        this._errorToStringOverrides = [
            [
                'A mutation operation was attempted on a database that did not allow mutations.',
                'Access to IndexedDB appears to be restricted. Firefox seems to require that the history preference is set to "Remember history" before IndexedDB use of any kind is allowed.'
            ],
            [
                'The operation failed for reasons unrelated to the database itself and not covered by any other error code.',
                'Unable to access IndexedDB due to a possibly corrupt user profile. Try using the "Refresh Firefox" feature to reset your user profile.'
            ]
        ];
    }

    async prepare() {
        this._purgeButton = document.querySelector('#dict-purge-button');
        this._purgeConfirmButton = document.querySelector('#dict-purge-confirm');
        this._importFileButton = document.querySelector('#dict-file-button');
        this._importFileInput = document.querySelector('#dict-file');
        this._purgeConfirmModal = new Modal(document.querySelector('#dict-purge-modal'));
        this._errorContainer = document.querySelector('#dict-error');
        this._spinner = document.querySelector('#dict-spinner');
        this._progressContainer = document.querySelector('#dict-import-progress');
        this._progressBar = this._progressContainer.querySelector('.progress-bar');
        this._purgeNotification = document.querySelector('#dict-purge');
        this._importInfo = document.querySelector('#dict-import-info');

        this._purgeButton.addEventListener('click', this._onPurgeButtonClick.bind(this), false);
        this._purgeConfirmButton.addEventListener('click', this._onPurgeConfirmButtonClick.bind(this), false);
        this._importFileButton.addEventListener('click', this._onImportButtonClick.bind(this), false);
        this._importFileInput.addEventListener('change', this._onImportFileChange.bind(this), false);
    }

    // Private

    _onImportButtonClick() {
        this._importFileInput.click();
    }

    _onPurgeButtonClick(e) {
        e.preventDefault();
        this._purgeConfirmModal.setVisible(true);
    }

    _onPurgeConfirmButtonClick(e) {
        e.preventDefault();
        this._purgeConfirmModal.setVisible(false);
        this._purgeDatabase();
    }

    _onImportFileChange(e) {
        const node = e.currentTarget;
        const files = [...node.files];
        node.value = null;
        this._importDictionaries(files);
    }

    async _purgeDatabase() {
        if (this._modifying) { return; }

        const purgeNotification = this._purgeNotification;

        const prevention = this._preventPageExit();

        try {
            this._setModifying(true);
            this._hideErrors();
            this._setSpinnerVisible(true);
            purgeNotification.hidden = false;

            await api.purgeDatabase();
            const errors = await this._clearDictionarySettings();

            if (errors.length > 0) {
                this._showErrors(errors);
            }
        } catch (error) {
            this._showErrors([error]);
        } finally {
            prevention.end();
            purgeNotification.hidden = true;
            this._setSpinnerVisible(false);
            this._storageController.updateStats();
            this._setModifying(false);
        }
    }

    async _importDictionaries(files) {
        if (this._modifying) { return; }

        const importInfo = this._importInfo;
        const progressContainer = this._progressContainer;
        const progressBar = this._progressBar;
        const storageController = this._storageController;

        const prevention = this._preventPageExit();

        try {
            this._setModifying(true);
            this._hideErrors();
            this._setSpinnerVisible(true);
            progressContainer.hidden = false;

            const optionsFull = await this._settingsController.getOptionsFull();
            const importDetails = {
                prefixWildcardsSupported: optionsFull.global.database.prefixWildcardsSupported
            };

            const updateProgress = (total, current) => {
                const percent = (current / total * 100.0);
                progressBar.style.width = `${percent}%`;
                storageController.updateStats();
            };

            const fileCount = files.length;
            for (let i = 0; i < fileCount; ++i) {
                progressBar.style.width = '0';
                if (fileCount > 1) {
                    importInfo.hidden = false;
                    importInfo.textContent = `(${i + 1} of ${fileCount})`;
                }

                await this._importDictionary(files[i], importDetails, updateProgress);
            }
        } catch (err) {
            this._showErrors([err]);
        } finally {
            prevention.end();
            progressContainer.hidden = true;
            importInfo.textContent = '';
            importInfo.hidden = true;
            this._setSpinnerVisible(false);
            this._setModifying(false);
        }
    }

    async _importDictionary(file, importDetails, onProgress) {
        const dictionaryDatabase = await this._getPreparedDictionaryDatabase();
        try {
            const dictionaryImporter = new DictionaryImporter();
            const archiveContent = await this._readFile(file);
            const {result, errors} = await dictionaryImporter.importDictionary(dictionaryDatabase, archiveContent, importDetails, onProgress);
            api.triggerDatabaseUpdated('dictionary', 'import');
            const errors2 = await this._addDictionarySettings(result.sequenced, result.title);

            if (errors.length > 0) {
                const allErrors = [...errors, ...errors2];
                allErrors.push(new Error(`Dictionary may not have been imported properly: ${allErrors.length} error${allErrors.length === 1 ? '' : 's'} reported.`));
                this._showErrors(allErrors);
            }
        } finally {
            dictionaryDatabase.close();
        }
    }

    async _addDictionarySettings(sequenced, title) {
        const optionsFull = await this._settingsController.getOptionsFull();
        const targets = [];
        const profileCount = optionsFull.profiles.length;
        for (let i = 0; i < profileCount; ++i) {
            const {options} = optionsFull.profiles[i];
            const value = this._createDictionaryOptions();
            const path1 = ObjectPropertyAccessor.getPathString(['profiles', i, 'options', 'dictionaries', title]);
            targets.push({action: 'set', path: path1, value});

            if (sequenced && options.general.mainDictionary === '') {
                const path2 = ObjectPropertyAccessor.getPathString(['profiles', i, 'options', 'general', 'mainDictionary']);
                targets.push({action: 'set', path: path2, value: title});
            }
        }
        return await this._modifyGlobalSettings(targets);
    }

    async _clearDictionarySettings() {
        const optionsFull = await this._settingsController.getOptionsFull();
        const targets = [];
        const profileCount = optionsFull.profiles.length;
        for (let i = 0; i < profileCount; ++i) {
            const path1 = ObjectPropertyAccessor.getPathString(['profiles', i, 'options', 'dictionaries']);
            targets.push({action: 'set', path: path1, value: {}});
            const path2 = ObjectPropertyAccessor.getPathString(['profiles', i, 'options', 'general', 'mainDictionary']);
            targets.push({action: 'set', path: path2, value: ''});
        }
        return await this._modifyGlobalSettings(targets);
    }

    _setSpinnerVisible(visible) {
        this._spinner.hidden = !visible;
    }

    _preventPageExit() {
        return this._settingsController.preventPageExit();
    }

    _showErrors(errors) {
        const uniqueErrors = new Map();
        for (const error of errors) {
            yomichan.logError(error);
            const errorString = this._errorToString(error);
            let count = uniqueErrors.get(errorString);
            if (typeof count === 'undefined') {
                count = 0;
            }
            uniqueErrors.set(errorString, count + 1);
        }

        const fragment = document.createDocumentFragment();
        for (const [e, count] of uniqueErrors.entries()) {
            const div = document.createElement('p');
            if (count > 1) {
                div.textContent = `${e} `;
                const em = document.createElement('em');
                em.textContent = `(${count})`;
                div.appendChild(em);
            } else {
                div.textContent = `${e}`;
            }
            fragment.appendChild(div);
        }

        this._errorContainer.appendChild(fragment);
        this._errorContainer.hidden = false;
    }

    _hideErrors() {
        this._errorContainer.textContent = '';
        this._errorContainer.hidden = true;
    }

    _readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsBinaryString(file);
        });
    }

    _createDictionaryOptions() {
        return {
            priority: 0,
            enabled: true,
            allowSecondarySearches: false
        };
    }

    _errorToString(error) {
        error = (typeof error.toString === 'function' ? error.toString() : `${error}`);

        for (const [match, newErrorString] of this._errorToStringOverrides) {
            if (error.includes(match)) {
                return newErrorString;
            }
        }

        return error;
    }

    _setModifying(value) {
        this._modifying = value;
        this._setButtonsEnabled(!value);
    }

    _setButtonsEnabled(value) {
        value = !value;
        for (const node of document.querySelectorAll('.dictionary-modifying-input')) {
            node.disabled = value;
        }
    }

    async _getPreparedDictionaryDatabase() {
        const dictionaryDatabase = new DictionaryDatabase();
        await dictionaryDatabase.prepare();
        return dictionaryDatabase;
    }

    async _modifyGlobalSettings(targets) {
        const results = await this._settingsController.modifyGlobalSettings(targets);
        const errors = [];
        for (const {error} of results) {
            if (typeof error !== 'undefined') {
                errors.push(jsonToError(error));
            }
        }
        return errors;
    }
}
