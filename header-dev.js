// ==UserScript==
// @name        WME Quick PP Importer
// @namespace   https://github.com/gk1220
// @version     2026.04.11.00
// @description Quickly add place points based on open address data sources.
// @author      Gerhard (g1220k)
// @homepageURL https://github.com/gk1220/wme-quick-pp-importer
// @supportURL  https://github.com/gk1220/wme-quick-pp-importer/issues
// @updateURL	https://github.com/gk1220/wme-quick-pp-importer/raw/main/WME_Quick_PP_Importer.user.js
// @downloadURL https://github.com/gk1220/wme-quick-pp-importer/raw/main/WME_Quick_PP_Importer.user.js
// @match       https://www.waze.com/editor*
// @match       https://beta.waze.com/editor*
// @match       https://www.waze.com/*/editor*
// @match       https://beta.waze.com/*/editor*
// @exclude     https://www.waze.com/user/editor*
// @exclude     https://beta.waze.com/user/editor*
// @connect     wms.kbox.at
// @license     GPL-3.0
// @grant       GM_xmlhttpRequest
// @grant       unsafeWindow

// @require       file:///home/gerhard.kronstorfer/Waze/WME_scripts/wme-quick-pp-importer/.out/main.user.js
// ==/UserScript==

// make sure that inside Tampermonkey's extension settings (on the browser, not from TM) and allow "Local file access", as shown here: https://www.tampermonkey.net/faq.php?locale=en#Q204
// make sure that the snippts inside header.js and header-dev.js are the same, except for the one @require field
// adjust the require field to the location of the .out/main.user.js file inside this directory
// copy the above snippet (up to ==/Userscript==) inside Tampermonkey's editor and save it