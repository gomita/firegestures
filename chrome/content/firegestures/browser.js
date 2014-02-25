//////////////////////////////////////////////////
// FireGestures

var FireGestures = {

	_gestureHandler: null,	// xdIGestureHandler

	_gestureMapping: null,	// xdIGestureMapping

	_getLocaleString: null,

	_statusTextField: null,

	_clearStatusTimer: null,

	_statusDisplay: null,

	get _isWin() {
		delete this._isWin;
		return this._isWin = navigator.platform.startsWith("Win");
	},

	init: function() {
		if ("aioGestTable" in window || "mozgestInit" in window || "ucjsMouseGestures" in window) {
			Cu.reportError("Detected an extension or script which conflicts with FireGestures.");
			toJavaScriptConsole();
			return;
		}
		var gestureSvc = Cc["@xuldev.org/firegestures/service;1"].getService(Ci.xdIGestureService);
		this._gestureHandler = gestureSvc.createHandler();
		this._gestureHandler.attach(gBrowser.mPanelContainer, this);
		this._gestureMapping = gestureSvc.getMappingForBrowser();
		this._getLocaleString = gestureSvc.getLocaleString;
		this._statusTextField = document.getElementById("statusbar-display");
		// [Firefox26] status panel will be generated dynamically @see Bug 821687
		if (!this._statusTextField)
			this._statusTextField = gBrowser.getStatusPanel();
		// disable built-in swipe gesture
		window.removeEventListener("MozSwipeGesture", gGestureSupport, true);
	},

	uninit: function() {
		if (this._gestureHandler) {
			this._gestureHandler.detach();
			this._gestureHandler = null;
		}
		this._gestureMapping = null;
		this._getLocaleString = null;
		if (this._clearStatusTimer)
			window.clearTimeout(this._clearStatusTimer);
		this._statusTextField = null;
	},


	/* ::::: xdIGestureObserver ::::: */

	get fullZoom() {
		return gBrowser.mCurrentBrowser.markupDocumentViewer.fullZoom;
	},

	canStartGesture: function(event) {
		if (gInPrintPreviewMode) {
			dump("*** suppress starting gesture in print preview mode\n");	// #debug
			return false;
		}
		// XXX a hackish way to detect whether the current tab is in Tilt mode
		if (event.target instanceof HTMLCanvasElement && 
		    event.target.parentNode instanceof Ci.nsIDOMXULElement) {
			dump("*** suppress starting gesture in Tilt 3D View\n");	// #debug
			return false;
		}
		return true;
	},

	onDirectionChanged: function(event, aDirectionChain) {
		if (this._statusDisplay > 0) {
			var command = this._gestureMapping.getCommandForDirection(aDirectionChain);
			var name = command ? " (" + command.name + ")" : "";
			this.setStatusText(this._getLocaleString("GESTURE") + ": " + aDirectionChain + name);
		}
	},

	onMouseGesture: function(event, aDirection) {
		// dump("onMouseGesture(" + aDirection + ")\n");	// #debug
		try {
			var command = this._gestureMapping.getCommandForDirection(aDirection);
			if (!command)
				throw null;
			if (command.type == this._gestureMapping.TYPE_SCRIPT)
				(new Function("event", command.value))(event);
			else
				this._performAction(event, command.value);
		}
		catch(ex) {
			if (this._statusDisplay > 0) {
				this.setStatusText(
					ex ? 
					this._getLocaleString("GESTURE_FAILED")  + ": " + aDirection + " (" + ex + ")" :
					this._getLocaleString("GESTURE_UNKNOWN") + ": " + aDirection
				);
			}
			if (ex) Cu.reportError(ex);	// #debug
		}
		if (this._statusDisplay > 0)
			this.clearStatusText(this._statusDisplay);
	},

	onExtraGesture: function(event, aGesture) {
		// dump("onExtraGesture(" + aGesture + ")\n");	// #debug
		switch (aGesture) {
			case "wheel-up": 
			case "wheel-down": 
			case "rocker-left": 
			case "rocker-right": 
			case "keypress-ctrl": 
			case "keypress-shift": 
			case "swipe-left": 
			case "swipe-right": 
			case "swipe-up": 
			case "swipe-down": 
				this.onMouseGesture(event, aGesture);
				break;
			case "keypress-start": 
				this.clearStatusText(0);
				this._linkURLs = [];
				this._linkElts = [];
				break;
			case "keypress-progress": 
				var linkURL = this.getLinkURL(event.target);
				if (!this._linkURLs)
					this._linkURLs = [];
				if (linkURL && this._linkURLs.indexOf(linkURL) < 0) {
					try {
						this.checkURL(linkURL, event.target.ownerDocument);
						this._linkURLs.push(linkURL);
						this._linkElts.push(event.target);
						event.target.style.outline = "1px dashed darkorange";
					}
					catch(ex) {}	// unsafe link
				}
				break;
			case "keypress-stop": 
				for (var i = 0; i < this._linkURLs.length; i++) {
					this._linkElts[i].style.outline = "";
					this._linkElts[i] = null;	// just in case
				}
				this._linkURLs = null;
				this._linkElts = null;
				break;
			case "gesture-timeout": 
				this.clearStatusText(0);
				break;
			case "reload-prefs": 
				var pref = "extensions.firegestures.status_display";
				this._statusDisplay = Services.prefs.getIntPref(pref);
				break;
		}
	},

	_performAction: function(event, aCommand) {
		switch (aCommand) {
			case "Browser:Back": 
				BrowserBack(event && event.type == "MozSwipeGesture" ? event : undefined);
				break;
			case "Browser:Forward": 
				BrowserForward(event && event.type == "MozSwipeGesture" ? event : undefined);
				break;
			case "FireGestures:GoUpperLevel": 
				this.goUpperLevel();
				break;
			case "FireGestures:IncrementURL": 
				this.goNumericURL(+1);
				break;
			case "FireGestures:DecrementURL": 
				this.goNumericURL(-1);
				break;
			case "FireGestures:MinimizeWindow": 
				// Fixed bug: window gets focused rapidly after minimizing with rocker gesture
				if (event)
					event.preventDefault();
				window.minimize();
				break;
			case "FireGestures:MaximizeWindow": 
				window.windowState == window.STATE_MAXIMIZED ? window.restore() : window.maximize();
				break;
			case "cmd_close": 
				// enables tab closing animation
				// don't close app tab
				if (gBrowser.mCurrentTab.pinned)
					throw "Blocked closing app tab.";
				gBrowser.removeCurrentTab({ animate: true });
				break;
			case "FireGestures:CloseTabOrWindow": 
				// don't close app tab
				if (gBrowser.mCurrentTab.pinned)
					throw "Blocked closing app tab.";
				if (gBrowser.mTabs.length > 1)
					document.getElementById("cmd_close").doCommand();
				else
					document.getElementById("cmd_closeWindow").doCommand();
				break;
			case "FireGestures:UndoCloseTab": 
				document.getElementById("History:UndoCloseTab").doCommand();
				break;
			case "FireGestures:PreviousTab": 
				gBrowser.mTabContainer.advanceSelectedTab(-1, true);
				break;
			case "FireGestures:NextTab": 
				gBrowser.mTabContainer.advanceSelectedTab(+1, true);
				break;
			case "FireGestures:DuplicateTab": 
				var orgTab = gBrowser.mCurrentTab;
				var newTab = gBrowser.duplicateTab(orgTab);
				gBrowser.moveTabTo(newTab, orgTab._tPos + 1);
				break;
			case "FireGestures:DetachTab": 
				gBrowser.replaceTabWithWindow(gBrowser.mCurrentTab);
				break;
			case "FireGestures:TogglePinTab": 
				var tab = gBrowser.mCurrentTab;
				tab.pinned ? gBrowser.unpinTab(tab) : gBrowser.pinTab(tab);
				break;
			case "FireGestures:ReloadAllTabs": 
				gBrowser.reloadAllTabs(gBrowser.mCurrentTab);
				break;
			case "FireGestures:CloseOtherTabs": 
				gBrowser.removeAllTabsBut(gBrowser.mCurrentTab);
				break;
			case "FireGestures:CloseLeftTabs": 
				this.closeMultipleTabs("left");
				break;
			case "FireGestures:CloseRightTabs": 
				this.closeMultipleTabs("right");
				break;
			case "cmd_textZoomEnlarge": 
			case "cmd_textZoomReduce": 
				if ("FullZoom" in window && !ZoomManager.useFullZoom)
					// if full zoom is disabled, text zoom can be replaced to full zoom.
					document.getElementById(aCommand.replace("text", "full")).doCommand();
				else
					// if full zoom is enabled, text zoom cannot save site-specific pref.
					gBrowser.markupDocumentViewer.textZoom += (aCommand == "cmd_textZoomEnlarge") ? 0.2 : -0.2;
				break;
			case "cmd_fullZoomEnlarge": 
			case "cmd_fullZoomReduce": 
				if (ZoomManager.useFullZoom)
					// if full zoom is enabled, just do the command.
					document.getElementById(aCommand).doCommand();
				else
					// if full zoom is disabled, full zoom cannot save site-specific pref.
					gBrowser.markupDocumentViewer.fullZoom += (aCommand == "cmd_fullZoomEnlarge") ? 0.2 : -0.2;
				break;
			case "cmd_textZoomReset": 
				if ("FullZoom" in window)
					// reset text zoom can be replaced to reset full zoom.
					aCommand = aCommand.replace("text", "full");
				document.getElementById(aCommand).doCommand();
				break;
			case "FireGestures:ScrollTop": 
				this._performScrollAction("cmd_scrollTop", "DOM_VK_HOME");
				break;
			case "FireGestures:ScrollBottom": 
				this._performScrollAction("cmd_scrollBottom", "DOM_VK_END");
				break;
			case "FireGestures:ScrollPageUp": 
				this._performScrollAction("cmd_scrollPageUp", "DOM_VK_PAGE_UP");
				break;
			case "FireGestures:ScrollPageDown": 
				this._performScrollAction("cmd_scrollPageDown", "DOM_VK_PAGE_DOWN");
				break;
			case "FireGestures:ShowOnlyThisFrame": 
				var docURL = this.sourceNode.ownerDocument.location.href;
				this.checkURL(docURL, gBrowser.contentDocument, Ci.nsIScriptSecurityManager.DISALLOW_SCRIPT);
				gBrowser.loadURI(docURL);
				break;
			case "FireGestures:OpenFrame": 
			case "FireGestures:OpenFrameInTab": 
			case "FireGestures:ReloadFrame": 
			case "FireGestures:AddBookmarkForFrame": 
			case "FireGestures:SaveFrame": 
			case "FireGestures:ViewFrameSource": 
			case "FireGestures:ViewFrameInfo": 
				// XXXtotally hack!
				var funcName = aCommand.substr("FireGestures:".length);
				funcName = funcName.charAt(0).toLowerCase() + funcName.substr(1);
				nsContextMenu.prototype.target = this.sourceNode;
				try { nsContextMenu.prototype[funcName](); }
				finally { nsContextMenu.prototype.target = null; }
				break;
			// @see nsContextMenu::openLink()
			case "FireGestures:OpenLink": 
				var linkURL = this.getLinkURL();
				if (!linkURL)
					throw this._getLocaleString("ERROR_NOT_ON_LINK");
				var doc = this.sourceNode.ownerDocument;
				this.checkURL(linkURL, doc);
				openLinkIn(linkURL, "window", {
					charset: doc.characterSet, referrerURI: doc.documentURIObject
				});
				break;
			case "FireGestures:OpenLinkInBgTab": 
			case "FireGestures:OpenLinkInFgTab": 
				var linkURL = this.getLinkURL();
				if (!linkURL)
					throw this._getLocaleString("ERROR_NOT_ON_LINK");
				var doc = this.sourceNode.ownerDocument;
				this.checkURL(linkURL, doc);
				// [TreeStyleTab] the next line will be replaced to open child tab
				gBrowser.loadOneTab(linkURL, {
					referrerURI: doc.documentURIObject, charset: doc.characterSet, 
					inBackground: aCommand == "FireGestures:OpenLinkInBgTab", 
					relatedToCurrent: true
				});
				break;
			// @see nsContextMenu::openLinkInPrivateWindow()
			case "FireGestures:OpenLinkInPrivateWindow": 
				var linkURL = this.getLinkURL();
				if (!linkURL)
					throw this._getLocaleString("ERROR_NOT_ON_LINK");
				var doc = this.sourceNode.ownerDocument;
				this.checkURL(linkURL, doc);
				openLinkIn(linkURL, "window", {
					charset: doc.characterSet, referrerURI: doc.documentURIObject, private: true
				});
				break;
			// @see browser.xul menuitem#context-bookmarklink@oncommand
			case "FireGestures:AddBookmarkForLink": 
				var linkURL = this.getLinkURL();
				if (!linkURL)
					throw this._getLocaleString("ERROR_NOT_ON_LINK");
				PlacesCommandHook.bookmarkLink(PlacesUtils.bookmarksMenuFolderId, linkURL, this.getLinkText());
				break;
			// @see nsContextMenu::saveLink()
			case "FireGestures:SaveLink": 
				var linkURL = this.getLinkURL();
				if (!linkURL)
					throw this._getLocaleString("ERROR_NOT_ON_LINK");
				var doc = this.sourceNode.ownerDocument;
				this.checkURL(linkURL, doc);
				// XXX using saveHelper is a bit hackish but good to handle appropriate MIME-type
				var linkText = gatherTextUnder(this.sourceNode);
				nsContextMenu.prototype.saveHelper(linkURL, linkText, null, true, doc);
				break;
			case "FireGestures:ViewImage": 
				var imageURL = this.getImageURL();
				if (!imageURL)
					throw this._getLocaleString("ERROR_NOT_ON_IMAGE");
				var onCanvas = this.sourceNode instanceof HTMLCanvasElement;
				if (onCanvas)
					this.checkURL(imageURL, gBrowser.contentDocument, Ci.nsIScriptSecurityManager.DISALLOW_SCRIPT);
				openUILink(imageURL, event);
				break;
			case "FireGestures:SaveImage": 
			case "FireGestures:SaveImageNow": 
				var mediaURL = this.getMediaURL();
				if (!mediaURL)
					throw this._getLocaleString("ERROR_NOT_ON_IMAGE");
				var doc = this.sourceNode.ownerDocument;
				var skipPrompt = aCommand == "FireGestures:SaveImageNow";
				if (this.sourceNode instanceof HTMLVideoElement || 
				    this.sourceNode instanceof HTMLAudioElement) {
					// save video and audio
					this.checkURL(mediaURL, doc);
					var dialogTitle = this.sourceNode instanceof HTMLVideoElement
					                ? "SaveVideoTitle" : "SaveAudioTitle";
					// FIXME saveHelper always shows prompt
					nsContextMenu.prototype.saveHelper(mediaURL, null, dialogTitle, false, doc);
				}
				else if (this.sourceNode instanceof HTMLCanvasElement) {
					// save canvas
					saveImageURL(mediaURL, "canvas.png", "SaveImageTitle", 
					             false, skipPrompt, doc.documentURIObject, doc);
				}
				else {
					// save image
					this.checkURL(mediaURL, doc);
					saveImageURL(mediaURL, null, "SaveImageTitle", 
					             false, skipPrompt, doc.documentURIObject, doc);
				}
				break;
			case "FireGestures:WebSearch": 
				BrowserSearch.loadSearch(getBrowserSelection(), true);
				break;
			case "FireGestures:OpenLinksInSelection": 
				var linkURLs = this.gatherLinkURLsInSelection();
				if (!linkURLs || linkURLs.length == 0)
					throw "No valid links in selection";
				var doc = this.sourceNode.ownerDocument;
				var referer = makeURI(doc.location.href);
				var charset = window.content.document.characterSet;
				this.openURLs(linkURLs, referer, charset);
				break;
			case "FireGestures:OpenURLsInSelection": 
				this.openURLsInSelection();
				break;
			case "FireGestures:ErrorConsole": 
				toJavaScriptConsole();
				break;
			case "FireGestures:WebConsole": 
				HUDConsoleUI.toggleHUD();
				break;
			case "FireGestures:BookmarksSidebar": 
				toggleSidebar("viewBookmarksSidebar");
				break;
			case "FireGestures:HistorySidebar": 
				toggleSidebar("viewHistorySidebar");
				break;
			case "FireGestures:FindBar": 
				gFindBar.hidden ? gFindBar.onFindCommand() : gFindBar.close();
				break;
			case "FireGestures:RestartApp": 
				Application.restart();
				break;
			case "FireGestures:Preferences": 
				this._gestureMapping.configure();
				break;
			case "FireGestures:HybridSave": 
			case "FireGestures:HybridBookmark": 
				var onLink  = this.getLinkURL()  != null;
				var onMedia = this.getMediaURL() != null;
				var inFrame = this.sourceNode.ownerDocument != window.content.document;
				if (aCommand == "FireGestures:HybridSave") {
					if (onLink)       aCommand = "FireGestures:SaveLink";
					else if (onMedia) aCommand = "FireGestures:SaveImage";
					else if (inFrame) aCommand = "FireGestures:SaveFrame";
					else              aCommand = "Browser:SavePage";
				}
				else {
					if (onLink)       aCommand = "FireGestures:AddBookmarkForLink";
					else if (inFrame) aCommand = "FireGestures:AddBookmarkForFrame";
					else              aCommand = "Browser:AddBookmarkAs";
				}
				// call _performAction again
				this._performAction(event, aCommand);
				break;
			case "FireGestures:HybridSendURL": 
				var url = this.getLinkURL() || this.getImageURL();
				if (url)
					MailIntegration.sendMessage(url, "");
				else
					MailIntegration.sendLinkForWindow(window.content);
				break;
			case "FireGestures:HybridCopyURL": 
				var url = this.getLinkURL() || this.getImageURL() || 
				          this.sourceNode.ownerDocument.location.href;
				var clipboard = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
				clipboard.copyString(url);
				break;
			case "FireGestures:HybridMetaData": 
				// 'View Image Info' works only for plain images
				if (this.sourceNode instanceof Ci.nsIImageLoadingContent && this.sourceNode.src)
					BrowserPageInfo(this.sourceNode.ownerDocument, "mediaTab", this.sourceNode);
				else
					BrowserPageInfo(this.sourceNode.ownerDocument);
				break;
			case "FireGestures:HybridViewSource": 
				if (this.getSelectedText())
					nsContextMenu.prototype.viewPartialSource("selection");
				else
					BrowserViewSourceOfDocument(this.sourceNode.ownerDocument);
				break;
			case "FireGestures:AllTabsPopup": 
			case "FireGestures:BFHistoryPopup": 
			case "FireGestures:ClosedTabsPopup": 
			case "FireGestures:WebSearchPopup": 
				this._buildPopup(aCommand, event && event.type == "DOMMouseScroll");
				break;
			case "FireGestures:AllScriptsPopup": 
				const kTypeCol    = 0;
				const kNameCol    = 1;
				const kCommandCol = 2;
				var items = this._gestureMapping.getMappingArray().filter(function(item) {
					return item[kTypeCol] == this._gestureMapping.TYPE_SCRIPT;
				}, this);
				var names = items.map(function(item) item[kNameCol]);
				var ret = {};
				var ok = Services.prompt.select(
					window, "FireGestures", this._getLocaleString("CHOOSE_SCRIPT"), 
					names.length, names, ret
				);
				if (!ok || ret.value < 0)
					return;
				new Function("event", items[ret.value][kCommandCol])(event);
				break;
			case "FireGestures:OpenHoveredLinks": 
				var doc = this.sourceNode.ownerDocument;
				var referer = makeURI(doc.location.href);
				var charset = window.content.document.characterSet;
				this.openURLs(this._linkURLs, referer, charset);
				break;
			case "FireGestures:SaveHoveredLinks": 
				var delay = 0;
				var doc = this.sourceNode.ownerDocument;
				var ref = makeURI(doc.location.href, doc.characterSet);
				this._linkURLs.forEach(function(aURL) {
					window.setTimeout(function() { saveURL(aURL, null, null, false, true, ref, doc); }, delay);
					delay += 1000;
				});
				break;
			case "FireGestures:CopyHoveredLinks": 
				if (this._linkURLs.length < 1)
					// do not copy empty string to prevent clearing clipboard
					return;
				var newLine = this._isWin ? "\r\n" : "\n";
				var urls = this._linkURLs.join(newLine);
				if (this._linkURLs.length > 1)
					urls += newLine;
				var clipboard = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
				clipboard.copyString(urls);
				break;
			default: 
				var cmd = document.getElementById(aCommand);
				if (cmd && cmd.getAttribute("disabled") != "true")
					cmd.doCommand();
		}
	},

	_performScrollAction: function(aCommand, aKeyCode) {
		// [Mac][Linux] to fix #70, always use goDoCommand
		if (!this._isWin || 
		    this.sourceNode instanceof HTMLInputElement || 
		    this.sourceNode instanceof HTMLTextAreaElement || 
		    gBrowser.mPrefs.getBoolPref("accessibility.browsewithcaret"))
			goDoCommand(aCommand);
		else
			this.sendKeyEvent({ keyCode: aKeyCode });
	},

	get sourceNode() {
		return this._gestureHandler.sourceNode;
	},

	get focusedWindow() {
		var win = document.commandDispatcher.focusedWindow;
		if (win == window)
			win = window.content;
		return win;
	},

	getLinkURL: function(aNode) {
		if (!aNode)
			aNode = this.sourceNode;
		while (aNode) {
			if ((aNode instanceof HTMLAnchorElement || aNode instanceof HTMLAreaElement) && aNode.href)
				return aNode.href;
			aNode = aNode.parentNode;
		}
		// not on a link
		return null;
	},

	// NOTE: this method uses |gatherTextUnder| defined in utilityOverlay.js
	getLinkText: function(aNode) {
		if (!aNode)
			aNode = this.sourceNode;
		var text = gatherTextUnder(aNode);
		if (!text || !text.match(/\S/)) {
			text = aNode.getAttribute("title");
			if (!text || !text.match(/\S/)) {
				text = aNode.getAttribute("alt");
				if (!text || !text.match(/\S/)) {
					text = this.getLinkURL(aNode);
				}
			}
		}
		return text;
	},

	// returns src attribute of an img element or data: URL of a canvas element
	// on the starting point of a gesture
	// returns null if no image element on the starting point
	getImageURL: function(aNode) {
		if (!aNode)
			aNode = this.sourceNode;
		if (aNode instanceof Ci.nsIImageLoadingContent && aNode.src)
			return aNode.src;
		else if (aNode instanceof HTMLCanvasElement)
			return aNode.toDataURL();
		// background image
		// @see nsContextMenu::setTarget()
		if (aNode instanceof HTMLHtmlElement)
			aNode = aNode.ownerDocument.body;
		var win = aNode.ownerDocument.defaultView;
		while (aNode) {
			if (aNode.nodeType == Node.ELEMENT_NODE) {
				var url = win.getComputedStyle(aNode, "").getPropertyCSSValue("background-image");
				if (url instanceof CSSValueList && url.length > 0) {
					url = url[0];
					if (url.primitiveType == CSSPrimitiveValue.CSS_URI)
						return makeURLAbsolute(aNode.baseURI, url.getStringValue());
				}
			}
			aNode = aNode.parentNode;
		}
		return null;
	},

	getMediaURL: function(aNode) {
		if (!aNode)
			aNode = this.sourceNode;
		if (aNode instanceof HTMLVideoElement || aNode instanceof HTMLAudioElement)
			return aNode.currentSrc || aNode.src;
		else
			return this.getImageURL(aNode);
	},

	getSelectedText: function() {
		return this.focusedWindow.getSelection().toString();
	},

	gatherLinkURLsInSelection: function() {
		var win = this.focusedWindow;
		var sel = win.getSelection();
		if (!sel || sel.isCollapsed)
			return null;
		var doc = win.document;
		var ret = [];
		for (var i = 0; i < sel.rangeCount; i++) {
			var range = sel.getRangeAt(i);
			var fragment = range.cloneContents();
			var treeWalker = fragment.ownerDocument.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT, null, true);
			while (treeWalker.nextNode()) {
				var node = treeWalker.currentNode;
				if ((node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement) && node.href) {
					try {
						this.checkURL(node.href, doc, Ci.nsIScriptSecurityManager.DISALLOW_SCRIPT);
						ret.push(node.href);
					}
					catch(ex) {
						alert(ex);	// #debug
					}
				}
			}
		}
		return ret;
	},

	// wrapper function of |urlSecurityCheck|
	checkURL: function(aURL, aDoc, aFlags) {
		urlSecurityCheck(aURL, aDoc.nodePrincipal, aFlags);
	},

	// open multiple URLs next to the current tab
	openURLs: function(aURLs, aReferer, aCharset) {
		// [TreeStyleTab]
		if ("TreeStyleTabService" in window)
			TreeStyleTabService.readyToOpenChildTab(gBrowser, true);
		for (let aURL of aURLs) {
			gBrowser.loadOneTab(aURL, {
				referrerURI: aReferer, charset: aCharset, 
				inBackground: true, relatedToCurrent: true
			});
		}
		// [TreeStyleTab]
		if ("TreeStyleTabService" in window)
			TreeStyleTabService.stopToOpenChildTab(gBrowser);
	},

	// go to upper directory of the current URL
	goUpperLevel: function() {
		var uri = gBrowser.currentURI;
		if (uri.schemeIs("about")) {
			loadURI("about:about");
			return;
		}
		if (uri.path == "/") {
			// http://www.example.com/   => http://example.com/
			// https://www.google.co.jp/ => https://google.co.jp/
			if (/:\/\/[^\.]+\.([^\.]+)\./.test(uri.prePath))
				loadURI(RegExp.leftContext + "://" + RegExp.$1 + "." + RegExp.rightContext + "/");
			return;
		}
		var pathList = uri.path.split("/");
		if (!pathList.pop())
			pathList.pop();
		loadURI(uri.prePath + pathList.join("/") + "/");
	},

	// increment or decrement number in URL
	goNumericURL: function(aIncrement) {
		var url = gBrowser.currentURI.spec;
		if (!url.match(/(\d+)(\D*)$/))
			throw "No numeric value in URL";
		var num = RegExp.$1;
		var digit = (num.charAt(0) == "0") ? num.length : null;
		num = parseInt(num, 10) + aIncrement;
		if (num < 0)
			throw "Cannot decrement number in URL anymore";
		num = num.toString();
		// pad with zero
		digit = digit - num.length;
		for (var i = 0; i < digit; i++)
			num = "0" + num;
		loadURI(RegExp.leftContext + num + RegExp.$2);
	},

	// open all URLs in the selection or search for selection
	openURLsInSelection: function() {
		var sel = this.getSelectedText();
		if (!sel)
			throw "No selection";
		var URLs = [];
		sel.split("\n").forEach(function(str) {
			// at least 8 chars continuously
			str = str.match(/([\w\+\-\=\$;:\?\.%,!#~\*\/@&]{8,})/);
			// regard string as non-URL if there are no periods
			if (!str || str[1].indexOf(".") < 0)
				return;
			// regard string as non-URL if there are more than two slashes or periods
			if (str[1].split("/").length < 3 && str[1].split(".").length < 3)
				return;
			str = str[1];
			// fix up URL
			if (str.indexOf("ttp://") == 0 || str.indexOf("ttps://") == 0)
				str = "h" + str;
			URLs.push(str);
		});
		if (URLs.length > 0)
			this.openURLs(URLs);
		else
			BrowserSearch.loadSearch(sel, true);
	},

	closeMultipleTabs: function(aLeftRight) {
		var tabs = gBrowser.visibleTabs.filter(function(tab) !tab.pinned);
		var pos = tabs.indexOf(gBrowser.mCurrentTab);
		var start = aLeftRight == "left" ? 0   : pos + 1;
		var stop  = aLeftRight == "left" ? pos : tabs.length;
		tabs = tabs.slice(start, stop);
		// alert(tabs.map(function(tab) "[" + tab._tPos + "] " + tab.label).join("\n"));
		// @see warnAboutClosingTabs in tabbrowser.xml
		var shouldPrompt = Services.prefs.getBoolPref("browser.tabs.warnOnCloseOtherTabs");
		if (shouldPrompt && tabs.length > 1) {
			var ps = Services.prompt;
			var bundle = gBrowser.mStringBundle;
			var message;
			try {
				// [Firefox29-]
				message = bundle.getFormattedString("tabs.closeWarningMultipleTabs", [tabs.length]);
			}
			catch (ex) {
				// [Firefox30+]
				message = PluralForm.get(tabs.length, bundle.getString("tabs.closeWarningMultiple")).
				          replace("#1", tabs.length);
			}
			window.focus();
			var ret = ps.confirmEx(
				window, bundle.getString("tabs.closeWarningTitle"), message, 
				ps.BUTTON_TITLE_IS_STRING * ps.BUTTON_POS_0 + ps.BUTTON_TITLE_CANCEL * ps.BUTTON_POS_1, 
				bundle.getString("tabs.closeButtonMultiple"), 
				null, null, null, {}
			);
			if (ret != 0)
				return;
		}
		tabs.reverse().forEach(function(tab) gBrowser.removeTab(tab));
	},

	sendKeyEvent: function(aOptions) {
		var evt = this.sourceNode.ownerDocument.createEvent("KeyEvents");
		evt.initKeyEvent(
			"keypress", true, true, null, 
			aOptions.ctrl  || false, 
			aOptions.alt   || false, 
			aOptions.shift || false, 
			aOptions.meta  || false, 
			aOptions.keyCode ? evt[aOptions.keyCode] : null, 
			aOptions.key ? aOptions.key.charCodeAt(0) : null
		);
		this.sourceNode.dispatchEvent(evt);
	},


	/* ::::: STATUS BAR ::::: */

	setStatusText: function(aText) {
		this._statusTextField.label = aText;
	},

	clearStatusText: function(aMillisec) {
		if (this._clearStatusTimer) {
			window.clearTimeout(this._clearStatusTimer);
			this._clearStatusTimer = null;
		}
		var text = this._statusTextField.label;
		var callback = function(self) {
			// dump("clearStatusText(" + text + " : " + self._statusTextField.label + ")\n");	// #debug
			self._clearStatusTimer = null;
			if (self._statusTextField.label == text)
				self.setStatusText("");
		};
		this._clearStatusTimer = window.setTimeout(callback, aMillisec, this);
	},


	/* ::::: POPUP ::::: */

	generatePopup: function(event, aAttrsList) {
		this._buildPopup("FireGestures:CustomPopup", event && event.type == "DOMMouseScroll", aAttrsList);
	},

	_buildPopup: function(aCommand, aWheelGesture, aAttrsList) {
		const POPUP_ID = "FireGesturesPopup";
		var popup = document.getElementById(POPUP_ID);
		var first = false;
		if (this._isWin) {
			// [Windows] if popup already exists, reuse it
			if (!popup) {
				popup = document.createElement("menupopup");
				first = true;
			}
		}
		else {
			// [Mac][Linux] always create new popup, since it might be a xul:panel or xul:menupopup
			if (popup)
				popup.parentNode.removeChild(popup);
			popup = document.createElement(aWheelGesture ? "panel" : "menupopup");
			first = true;
		}
		if (first) {
			document.getElementById("mainPopupSet").appendChild(popup);
			popup.id = POPUP_ID;
			popup.style.MozBinding = "url('chrome://firegestures/content/bindings.xml#popup')";
			popup.style.maxWidth = "42em";
		}
		// populate menu items
		switch (aCommand) {
			case "FireGestures:AllTabsPopup": 
				var tabs = gBrowser.mTabs;
				if (tabs.length < 1)
					return;	// just in case
				var pinned;
				for (var i = 0; i < tabs.length; i++) {
					let tab = tabs[i];
					// exclude tab in other group
					if (tab.hidden)
						continue;
					if (pinned && !tab.pinned)
						popup.appendChild(document.createElement("menuseparator"));
					pinned = tab.pinned;
					let menuitem = popup.appendChild(document.createElement("menuitem"));
					menuitem.setAttribute("label", tab.label);
					menuitem.setAttribute("crop", tab.getAttribute("crop"));
					menuitem.setAttribute("image", tab.getAttribute("image"));
					menuitem.setAttribute("class", "menuitem-iconic alltabs-item menuitem-with-favicon");
					menuitem.setAttribute("statustext", tab.linkedBrowser.currentURI.spec);
					menuitem.index = i;
					if (tab.selected)
						menuitem.setAttribute("default", "true");
				}
				// decorate menuitem which of tab is visible in overflowed tab strip
				// @see tabbrowser.xml: _updateTabsVisibilityStatus
				var tabContainer = gBrowser.tabContainer;
				if (tabContainer.getAttribute("overflow") != "true")
					break;
				var tabstrip = tabContainer.mTabstrip.scrollBoxObject;
				for (var i = 0; i < popup.childNodes.length; i++) {
					let menuitem = popup.childNodes[i];
					if (menuitem.localName != "menuitem")
						continue;	// exclude menuseparator
					let tab = gBrowser.mTabs[menuitem.index].boxObject;
					if (tab.screenX >= tabstrip.screenX && 
					    tab.screenY >= tabstrip.screenY && 
					    tab.screenX + tab.width  <= tabstrip.screenX + tabstrip.width && 
					    tab.screenY + tab.height <= tabstrip.screenY + tabstrip.height)
						menuitem.setAttribute("tabIsVisible", "true");
				}
				break;
			case "FireGestures:BFHistoryPopup": 
				var sessionHistory = gBrowser.webNavigation.sessionHistory;
				if (sessionHistory.count < 1)
					throw "No back/forward history for this tab.";
				var curIdx = sessionHistory.index;
				for (var i = 0; i < sessionHistory.count; i++) {
					let entry = sessionHistory.getEntryAtIndex(i, false);
					if (!entry)
						continue;
					let menuitem = document.createElement("menuitem");
					popup.insertBefore(menuitem, popup.firstChild);
					menuitem.setAttribute("label", entry.title);
					menuitem.setAttribute("statustext", entry.URI.spec);
					menuitem.index = i;
					if (i == curIdx) {
						menuitem.setAttribute("type", "radio");
						menuitem.setAttribute("checked", "true");
						menuitem.setAttribute("default", "true");
						menuitem.className = "unified-nav-current";
					}
					else {
						PlacesUtils.favicons.getFaviconURLForPage(entry.URI, function(aURI) {
							if (!aURI)
								return;
							let iconURL = PlacesUtils.favicons.getFaviconLinkForIcon(aURI).spec;
							menuitem.style.listStyleImage = "url(" + iconURL + ")";
						});
						menuitem.className = i < curIdx
						                   ? "unified-nav-back menuitem-iconic menuitem-with-favicon"
						                   : "unified-nav-forward menuitem-iconic menuitem-with-favicon";
					}
				}
				break;
			case "FireGestures:ClosedTabsPopup": 
				var ss = Cc["@mozilla.org/browser/sessionstore;1"].getService(Ci.nsISessionStore);
				if (ss.getClosedTabCount(window) == 0)
					throw "No restorable tabs in this window.";
				var undoItems = JSON.parse(ss.getClosedTabData(window));
				for (var i = 0; i < undoItems.length; i++) {
					let menuitem = popup.appendChild(document.createElement("menuitem"));
					menuitem.setAttribute("label", undoItems[i].title);
					menuitem.setAttribute("class", "menuitem-iconic bookmark-item menuitem-with-favicon");
					menuitem.index = i;
					let iconURL = undoItems[i].image;
					if (iconURL)
						menuitem.setAttribute("image", iconURL);
					// show title and URL in tooltip
					let tabData = undoItems[i].state;
					let activeIndex = (tabData.index || tabData.entries.length) - 1;
					if (activeIndex >= 0 && tabData.entries[activeIndex]) {
						let title = tabData.entries[activeIndex].title;
						let url   = tabData.entries[activeIndex].url;
						menuitem.setAttribute("tooltiptext", title + "\n" + url);
					}
				}
				break;
			case "FireGestures:WebSearchPopup": 
				var searchSvc = Cc["@mozilla.org/browser/search-service;1"].getService(Ci.nsIBrowserSearchService);
				var engines = searchSvc.getVisibleEngines({});
				if (engines.length < 1)
					throw "No search engines installed.";
				for (var i = engines.length - 1; i >= 0; --i) {
					var menuitem = document.createElement("menuitem");
					menuitem.setAttribute("label", engines[i].name);
					menuitem.setAttribute("class", "menuitem-iconic searchbar-engine-menuitem menuitem-with-favicon");
					if (engines[i].iconURI)
						menuitem.setAttribute("src", engines[i].iconURI.spec);
					popup.insertBefore(menuitem, popup.firstChild);
					menuitem.engine = engines[i];
				}
				break;
			case "FireGestures:CustomPopup": 
				for (let aAttrs of aAttrsList) {
					var menuitem;
					if (!aAttrs) {
						menuitem = document.createElement("menuseparator");
					}
					else {
						menuitem = document.createElement("menuitem");
						for (let [name, val] in Iterator(aAttrs)) {
							menuitem.setAttribute(name, val);
							if (menuitem.getAttribute("checked") == "true")
								menuitem.setAttribute("default", "true");
						}
					}
					popup.appendChild(menuitem);
				}
				break;
		}
		// open popup
		popup.setAttribute("wheelscroll", aWheelGesture ? "true" : "false");
		popup.setAttribute("_gesturecommand", aCommand);
		popup.addEventListener("DOMMenuItemActive", this, false);
		popup.addEventListener("DOMMenuItemInactive", this, false);
		popup.addEventListener("command", this, false);
		popup.addEventListener("popuphiding", this, false);
		document.popupNode = null;
		document.tooltipNode = null;
		this._gestureHandler.openPopupAtPointer(popup);
	},

	handleEvent: function(event) {
		var popup = document.getElementById("FireGesturesPopup");
		switch (event.type) {
			case "DOMMenuItemActive": 
				var statusText = event.target.getAttribute("statustext");
				if (statusText == "about:blank")
					statusText = " ";	// @see tabbrowser.xml
				if (statusText)
					XULBrowserWindow.setOverLink(statusText, null);
				break;
			case "DOMMenuItemInactive": 
				XULBrowserWindow.setOverLink("", null);
				break;
			case "command": 
				var item = popup.currentItem || event.target;
				if (popup.defaultItem == item)
					break;
				switch (popup.getAttribute("_gesturecommand")) {
					case "FireGestures:AllTabsPopup": 
						gBrowser.selectedTab = gBrowser.mTabs[item.index];
						break;
					case "FireGestures:BFHistoryPopup": 
						gBrowser.webNavigation.gotoIndex(item.index);
						break;
					case "FireGestures:ClosedTabsPopup": 
						undoCloseTab(item.index);
						break;
					case "FireGestures:WebSearchPopup": 
						var engine = item.engine;
						if (!engine)
							break;
						var submission = engine.getSubmission(getBrowserSelection(), null);
						if (!submission)
							break;
						// [TreeStyleTab] the next line will be replaced to open child tab
						gBrowser.loadOneTab(submission.uri.spec, {
							postData: submission.postData,
							relatedToCurrent: true
						});
						break;
				}
				break;
			case "popuphiding": 
				popup.removeAttribute("_gesturecommand");
				popup.removeEventListener("DOMMenuItemActive", this, false);
				popup.removeEventListener("DOMMenuItemInactive", this, false);
				popup.removeEventListener("command", this, false);
				popup.removeEventListener("popuphiding", this, false);
				break;
		}
	},


	/* ::::: nsISupports ::::: */

	QueryInterface: function(aIID) {
		if (!aIID.equals(Ci.nsISupports) && 
		    !aIID.equals(Ci.nsIDOMEventListener) &&
		    !aIID.equals(Ci.xdIGestureObserver)) {
			throw Cr.NS_ERROR_NO_INTERFACE;
		}
		return this;
	}

};


window.addEventListener("load",   function() { FireGestures.init(); },   false);
window.addEventListener("unload", function() { FireGestures.uninit(); }, false);


