/*
 * Copyright (C) 2017-2020  Yomichan Authors
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
 * SimpleDOMParser
 * jp
 */

class AudioUriBuilder {
    constructor({requestBuilder}) {
        this._requestBuilder = requestBuilder;
        this._getUrlHandlers = new Map([
            ['jpod101', this._getUriJpod101.bind(this)],
            ['jpod101-alternate', this._getUriJpod101Alternate.bind(this)],
            ['jisho', this._getUriJisho.bind(this)],
            ['text-to-speech', this._getUriTextToSpeech.bind(this)],
            ['text-to-speech-reading', this._getUriTextToSpeechReading.bind(this)],
            ['custom', this._getUriCustom.bind(this)]
        ]);
    }

    normalizeUrl(url, baseUrl, basePath) {
        if (url) {
            if (url[0] === '/') {
                if (url.length >= 2 && url[1] === '/') {
                    // Begins with "//"
                    url = baseUrl.substring(0, baseUrl.indexOf(':') + 1) + url;
                } else {
                    // Begins with "/"
                    url = baseUrl + url;
                }
            } else if (!/^[a-z][a-z0-9\-+.]*:/i.test(url)) {
                // No URI scheme => relative path
                url = baseUrl + basePath + url;
            }
        }
        return url;
    }

    async getUri(source, expression, reading, details) {
        const handler = this._getUrlHandlers.get(source);
        if (typeof handler === 'function') {
            try {
                return await handler(expression, reading, details);
            } catch (e) {
                // NOP
            }
        }
        return null;
    }

    async _getUriJpod101(expression, reading) {
        let kana = reading;
        let kanji = expression;

        if (!kana && jp.isStringEntirelyKana(kanji)) {
            kana = kanji;
            kanji = null;
        }

        const params = [];
        if (kanji) {
            params.push(`kanji=${encodeURIComponent(kanji)}`);
        }
        if (kana) {
            params.push(`kana=${encodeURIComponent(kana)}`);
        }

        return `https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?${params.join('&')}`;
    }

    async _getUriJpod101Alternate(expression, reading) {
        const fetchUrl = 'https://www.japanesepod101.com/learningcenter/reference/dictionary_post';
        const data = `post=dictionary_reference&match_type=exact&search_query=${encodeURIComponent(expression)}&vulgar=true`;
        const response = await this._requestBuilder.fetchAnonymous(fetchUrl, {
            method: 'POST',
            mode: 'cors',
            cache: 'default',
            credentials: 'omit',
            redirect: 'follow',
            referrerPolicy: 'no-referrer',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: data
        });
        const responseText = await response.text();

        const dom = new SimpleDOMParser(responseText);
        for (const row of dom.getElementsByClassName('dc-result-row')) {
            try {
                const audio = dom.getElementByTagName('audio', row);
                if (audio === null) { continue; }

                const source = dom.getElementByTagName('source', audio);
                if (source === null) { continue; }

                const url = dom.getAttribute(source, 'src');
                if (url === null) { continue; }

                const htmlReadings = dom.getElementsByClassName('dc-vocab_kana');
                if (htmlReadings.length === 0) { continue; }

                const htmlReading = dom.getTextContent(htmlReadings[0]);
                if (htmlReading && (!reading || reading === htmlReading)) {
                    return this.normalizeUrl(url, 'https://www.japanesepod101.com', '/learningcenter/reference/');
                }
            } catch (e) {
                // NOP
            }
        }

        throw new Error('Failed to find audio URL');
    }

    async _getUriJisho(expression, reading) {
        const fetchUrl = `https://jisho.org/search/${expression}`;
        const response = await this._requestBuilder.fetchAnonymous(fetchUrl, {
            method: 'GET',
            mode: 'cors',
            cache: 'default',
            credentials: 'omit',
            redirect: 'follow',
            referrerPolicy: 'no-referrer'
        });
        const responseText = await response.text();

        const dom = new SimpleDOMParser(responseText);
        try {
            const audio = dom.getElementById(`audio_${expression}:${reading}`);
            if (audio !== null) {
                const source = dom.getElementByTagName('source', audio);
                if (source !== null) {
                    const url = dom.getAttribute(source, 'src');
                    if (url !== null) {
                        return this.normalizeUrl(url, 'https://jisho.org', '/search/');
                    }
                }
            }
        } catch (e) {
            // NOP
        }

        throw new Error('Failed to find audio URL');
    }

    async _getUriTextToSpeech(expression, reading, {textToSpeechVoice}) {
        if (!textToSpeechVoice) {
            throw new Error('No voice');
        }
        return `tts:?text=${encodeURIComponent(expression)}&voice=${encodeURIComponent(textToSpeechVoice)}`;
    }

    async _getUriTextToSpeechReading(expression, reading, {textToSpeechVoice}) {
        if (!textToSpeechVoice) {
            throw new Error('No voice');
        }
        return `tts:?text=${encodeURIComponent(reading || expression)}&voice=${encodeURIComponent(textToSpeechVoice)}`;
    }

    async _getUriCustom(expression, reading, {customSourceUrl}) {
        if (typeof customSourceUrl !== 'string') {
            throw new Error('No custom URL defined');
        }
        const data = {expression, reading};
        return customSourceUrl.replace(/\{([^}]*)\}/g, (m0, m1) => (hasOwn(data, m1) ? `${data[m1]}` : m0));
    }
}
