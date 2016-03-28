/*
 * Copyright (C) 2016  Alex Yatskov <alex@foosoft.net>
 * Author: Alex Yatskov <alex@foosoft.net>
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
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */


class Client {
    constructor() {
        this.popup       = $('<div class="yomichan-popup"/>');
        this.popupOffset = 10;
        this.enabled     = false;

        $('body').append(this.popup).click(() => this.hidePopup());

        chrome.runtime.onMessage.addListener(this.onMessage.bind(this));
        window.addEventListener('mousemove', this.onMouseMove.bind(this));
        window.addEventListener('keydown', this.onKeyDown.bind(this));

        getState((state) => this.setEnabled(state === 'enabled'));
    }

    onKeyDown(e) {
        if (e.keyCode === 16 || e.charCode === 16) {
            this.hidePopup();
        }
    }

    onMouseMove(e) {
        if (!this.enabled || (!e.shiftKey && e.which !== 2)) {
            return;
        }

        const range = getRangeAtCursor(e, 10);
        if (range === null) {
            this.hidePopup();
            return;
        }

        const rect = getRangePaddedRect(range);
        if (e.clientX < rect.left || e.clientX > rect.right) {
            this.hidePopup();
            return;
        }

        findTerm(range.toString(), ({results, length}) => {
            if (length === 0) {
                this.hidePopup();
            } else {
                range.setEnd(range.endContainer, range.startOffset + length);
                renderTemplate({defs: results}, 'defs.html', (html) => {
                    this.popup.html(html);
                    this.showPopup(range);
                });
            }
        });
    }

    onMessage(request, sender, callback) {
        this.setEnabled(request === 'enabled');
        callback();
    }

    showPopup(range) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        const pos = getPopupPositionForRange(this.popup, range, this.popupOffset);
        this.popup.css({left: pos.x, top: pos.y, visibility: 'visible'});
    }

    hidePopup() {
        const selection = window.getSelection();
        selection.removeAllRanges();

        this.popup.css({visibility: 'hidden'});
    }

    setEnabled(enabled) {
        if (!(this.enabled = enabled)) {
            this.hidePopup();
        }
    }
}

window.yomiClient = new Client();
