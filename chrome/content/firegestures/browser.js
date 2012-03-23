//////////////////////////////////////////////////
// FireGestures

var FireGestures = {

	_gestureHandler: null,	// xdIGestureHandler

	_gestureMapping: null,	// xdIGestureMapping

	_getLocaleString: null,

	_statusTextField: null,

	_clearStatusTimer: null,

	get _isMac() {
		delete this._isMac;
		return this._isMac = navigator.platform.indexOf("Mac") >= 0;
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

	// cached value of 'status_display' preference
	// _statusDisplay === null: not cached
	// _statusDisplay === 0   : don't display status
	// _statusDisplay  >  0   : display status for the specified milliseconds
	_statusDisplay: null,

	canStartGesture: function(event) {
		if (gInPrintPreviewMode) {
			dump("*** suppress starting gesture in print preview mode\n");	// #debug
			return false;
		}
		if ("Tilt" in window && Tilt.tiltButton.checked) {
			dump("*** suppress starting gesture in Tilt 3D View\n");	// #debug
			return false;
		}
		return true;
	},

	onDirectionChanged: function(event, aDirectionChain) {
		if (this._statusDisplay === null) {
			const prefName = "extensions.firegestures.status_display";
			this._statusDisplay = (gPrefService || Services.prefs).getIntPref(prefName);
		}
		if (this._statusDisplay === 0)
			return;
		var command = this._gestureMapping.getCommandForDirection(aDirectionChain);
		var name = command ? " (" + command.name + ")" : "";
		this.setStatusText(this._getLocaleString("GESTURE") + ": " + aDirectionChain + name);
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
			this.setStatusText(
				ex ? 
				this._getLocaleString("GESTURE_FAILED")  + ": " + aDirection + " (" + ex + ")" :
				this._getLocaleString("GESTURE_UNKNOWN") + ": " + aDirection
			);
			if (ex) Cu.reportError(ex);	// #debug
		}
		this.clearStatusText(this._statusDisplay);
		this._statusDisplay = null;
	},

	onExtraGesture: function(event, aGesture) {
		// dump("onExtraGesture(" + aGesture + ")\n");	// #debug
		this.clearStatusText(0);
		switch (aGesture) {
			case "wheel-up": 
			case "wheel-down": 
			case "rocker-left": 
			case "rocker-right": 
			case "keypress-ctrl": 
			case "keypress-shift": 
				this.onMouseGesture(event, aGesture);
				return;
			case "keypress-start": 
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
						event.target.style.MozOutline = "1px dashed darkorange";
					}
					catch(ex) {}	// unsafe link
				}
				break;
			case "keypress-stop": 
				for (var i = 0; i < this._linkURLs.length; i++) {
					this._linkElts[i].style.MozOutline = "";
					this._linkElts[i] = null;	// just in case
				}
				this._linkURLs = null;
				this._linkElts = null;
				break;
			case "gesture-timeout": 
				this.clearStatusText(0);
				break;
		}
	},

	_performAction: function(event, aCommand) {
		switch (aCommand) {
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
				try { document.getElementById("History:UndoCloseTab").doCommand(); }
				catch(ex) {
					if ("undoRemoveTab" in gBrowser)
						// [TabMixPlus]
						gBrowser.undoRemoveTab();
					else
						throw "Session Restore feature is disabled.";
				}
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
				if (this.sourceNode instanceof HTMLInputElement || 
				    this.sourceNode instanceof HTMLTextAreaElement || 
				    gBrowser.mPrefs.getBoolPref("accessibility.browsewithcaret"))
					goDoCommand("cmd_scrollTop");
				else
					this.sendKeyEvent({ keyCode: "DOM_VK_HOME" });
				break;
			case "FireGestures:ScrollBottom": 
				if (this.sourceNode instanceof HTMLInputElement || 
				    this.sourceNode instanceof HTMLTextAreaElement || 
				    gBrowser.mPrefs.getBoolPref("accessibility.browsewithcaret"))
					goDoCommand("cmd_scrollBottom");
				else
					this.sendKeyEvent({ keyCode: "DOM_VK_END" });
				break;
			case "FireGestures:ScrollPageUp": 
				this.sendKeyEvent({ keyCode: "DOM_VK_PAGE_UP" });
				break;
			case "FireGestures:ScrollPageDown": 
				this.sendKeyEvent({ keyCode: "DOM_VK_PAGE_DOWN" });
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
				openNewWindowWith(linkURL, this.sourceNode.ownerDocument, null, false);
				break;
			case "FireGestures:OpenLinkInBgTab": 
			case "FireGestures:OpenLinkInFgTab": 
				var linkURL = this.getLinkURL();
				if (!linkURL)
					throw this._getLocaleString("ERROR_NOT_ON_LINK");
				var doc = this.sourceNode.ownerDocument;
				this.checkURL(linkURL, doc);
				var charset = window.content.document.characterSet;
				var referer = makeURI(doc.location.href);
				var background = aCommand == "FireGestures:OpenLinkInBgTab";
				gBrowser.loadOneTab(linkURL, referer, charset, null, background, false);
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
				saveURL(linkURL, this.getLinkText(), null, true, false,
				        makeURI(doc.location.href, doc.characterSet));
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
				var onCanvas = this.sourceNode instanceof HTMLCanvasElement;
				if (onCanvas)
					this.checkURL(mediaURL, doc);
				var skipPrompt = aCommand == "FireGestures:SaveImageNow";
				saveImageURL(mediaURL, onCanvas ? "canvas.png" : null, "SaveImageTitle", 
				             false, skipPrompt, doc.documentURIObject);
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
				if (this.getLinkURL() || this.getImageURL())
					window.openDialog(
						"chrome://browser/content/metaData.xul", "_blank", 
						"scrollbars,resizable,chrome,dialog=no", this.sourceNode
					);
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
				this._buildPopup(aCommand, event.type == "DOMMouseScroll");
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
				var ref = 'makeURI("' + doc.location.href + '", "' + doc.characterSet + '")';
				this._linkURLs.forEach(function(aURL) {
					window.setTimeout(
						'saveURL("' + aURL + '", null, null, false, true, ' + ref + ');', delay
					);
					delay += 1000;
				});
				break;
			case "FireGestures:CopyHoveredLinks": 
				if (this._linkURLs.length < 1)
					// do not copy empty string to prevent clearing clipboard
					return;
				var newLine = this._isMac ? "\n" : "\r\n";
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
		if (aNode instanceof HTMLImageElement && aNode.src)
			return aNode.src;
		else if (aNode instanceof HTMLCanvasElement)
			return aNode.toDataURL();
		return null;
	},

	getMediaURL: function(aNode) {
		if (!aNode)
			aNode = this.sourceNode;
		var imageURL = this.getImageURL(aNode);
		if (imageURL)
			return imageURL;
		else if (aNode instanceof HTMLVideoElement || aNode instanceof HTMLAudioElement)
			return aNode.currentSrc || aNode.src;
		else
			return null;
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
	openURLs: function(aURLs, aReferer, aCharset, aNextToCurrent) {
		// [TreeStyleTab]
		if ("TreeStyleTabService" in window)
			TreeStyleTabService.readyToOpenChildTab(gBrowser.selectedTab, true);
		var pos = gBrowser.mCurrentTab._tPos;
		for each (aURL in aURLs) {
			var tab = gBrowser.loadOneTab(aURL, aReferer, aCharset, null, true, false);
			if (aNextToCurrent)
				gBrowser.moveTabTo(tab, ++pos);
		}
		// [TreeStyleTab]
		if ("TreeStyleTabService" in window)
			TreeStyleTabService.stopToOpenChildTab(gBrowser.selectedTab);
	},

	// go to upper directory of the current URL
	goUpperLevel: function() {
		var uri = gBrowser.currentURI;
		if (uri.path == "/")
			return;
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
		sel = sel.split("\n");
		sel.forEach(function(str) {
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
		if ("closeLeftTabs" in gBrowser) {
			// [TabMixPlus]
			if (aLeftRight == "left")
				gBrowser.closeLeftTabs(gBrowser.mCurrentTab);
			else
				gBrowser.closeRightTabs(gBrowser.mCurrentTab);
			return;
		}
		// hack to make another version of built-in warnAboutClosingTabs
		if ("warnAboutClosingTabs2" in gBrowser == false)
			window.eval(
				"gBrowser.warnAboutClosingTabs2 = " + 
				gBrowser.warnAboutClosingTabs.toString()
				.replace("(aAll)", "(aAll, aTabsToClose)")
				.replace(/var tabsToClose = [^;]+;/, "var tabsToClose = aTabsToClose;")
			);
		var tabs = Array.slice(gBrowser.mTabs);
		var pos = gBrowser.mCurrentTab._tPos;
		var start = aLeftRight == "left" ? 0   : pos + 1;
		var stop  = aLeftRight == "left" ? pos : tabs.length;
		tabs = tabs.slice(start, stop).filter(function(tab) !tab.pinned && !tab.hidden);
		// alert(tabs.map(function(tab) "[" + tab._tPos + "] " + tab.label).join("\n"));
		if (!gBrowser.warnAboutClosingTabs2(false, tabs.length))
			return;
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

	_popupActiveItem: null,

	generatePopup: function(event, aAttrsList) {
		this._buildPopup("FireGestures:CustomPopup", event.type == "DOMMouseScroll", aAttrsList);
	},

	_buildPopup: function(aCommand, aWheelGesture, aAttrsList) {
		// if there is a popup element which has the specifed id, reuse it
		const POPUP_ID = "FireGesturesPopup";
		var popup = document.getElementById(POPUP_ID);
		if (!popup) {
			// XXX [Mac] use xul:panel instead of xul:menupopup to fix the problem that
			// no DOMMouseScroll events sent outside the popup.
			// However, this hack has a few of side effects:
			// 1) css rules for 'menupopup > menuitem' are not applied
			// 2) set _moz-menuactive="true" to a xul:menuitem has no effect
			// 3) set default="true" to a xul:menuitem has no effect
			if (this._isMac) {
				popup = document.createElement("panel");
				popup.setAttribute("noautohide", "true");
			}
			else {
				popup = document.createElement("menupopup");
			}
			popup.id = POPUP_ID;
			document.getElementById("mainPopupSet").appendChild(popup);
		}
		popup.setAttribute("_moz-gesturecommand", aCommand);
		var activeItem = null;
		switch (aCommand) {
			case "FireGestures:AllTabsPopup": 
				var tabs = gBrowser.mTabs;
				if (tabs.length < 1)
					return;	// just in case
				for (var i = 0; i < tabs.length; i++) {
					var tab = tabs[i];
					// exclude tab in other group
					if (tab.hidden)
						continue;
					var menuitem = popup.appendChild(document.createElement("menuitem"));
					menuitem.setAttribute("class", "menuitem-iconic bookmark-item");
					menuitem.setAttribute("label", tab.label);
					menuitem.setAttribute("crop", tab.getAttribute("crop"));
					menuitem.setAttribute("image", tab.getAttribute("image"));
					menuitem.setAttribute("statustext", tab.linkedBrowser.currentURI.spec);
					menuitem.index = i;
					if (tab.selected)
						activeItem = menuitem;
				}
				break;
			case "FireGestures:BFHistoryPopup": 
				var sessionHistory = gBrowser.webNavigation.sessionHistory;
				if (sessionHistory.count < 1)
					throw "No back/forward history for this tab.";
				var curIdx = sessionHistory.index;
				for (var i = 0; i < sessionHistory.count; i++) {
					var entry = sessionHistory.getEntryAtIndex(i, false);
					if (!entry)
						continue;
					var menuitem = document.createElement("menuitem");
					popup.insertBefore(menuitem, popup.firstChild);
					menuitem.setAttribute("label", entry.title);
					menuitem.setAttribute("statustext", entry.URI.spec);
					try {
						var iconURL = Cc["@mozilla.org/browser/favicon-service;1"]
						              .getService(Ci.nsIFaviconService)
						              .getFaviconForPage(entry.URI).spec;
						menuitem.style.listStyleImage = "url(" + iconURL + ")";
					}
					catch (ex) {}
					menuitem.index = i;
					if (i == curIdx) {
						menuitem.style.listStyleImage = "";
						menuitem.setAttribute("type", "radio");
						menuitem.setAttribute("checked", "true");
						menuitem.className = "unified-nav-current";
						activeItem = menuitem;
					}
					else {
						menuitem.className = i < curIdx
						                   ? "unified-nav-back menuitem-iconic"
						                   : "unified-nav-forward menuitem-iconic";
					}
				}
				break;
			case "FireGestures:ClosedTabsPopup": 
				var ss = Cc["@mozilla.org/browser/sessionstore;1"].getService(Ci.nsISessionStore);
				if (ss.getClosedTabCount(window) == 0)
					throw "No restorable tabs in this window.";
				var undoItems = eval("(" + ss.getClosedTabData(window) + ")");
				for (var i = 0; i < undoItems.length; i++) {
					var menuitem = popup.appendChild(document.createElement("menuitem"));
					menuitem.setAttribute("label", undoItems[i].title);
					menuitem.setAttribute("class", "menuitem-iconic bookmark-item");
					menuitem.index = i;
					var iconURL = undoItems[i].image;
					if (iconURL)
						menuitem.setAttribute("image", iconURL);
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
					menuitem.setAttribute("class", "menuitem-iconic");
					if (engines[i].iconURI)
						menuitem.setAttribute("src", engines[i].iconURI.spec);
					popup.insertBefore(menuitem, popup.firstChild);
					menuitem.engine = engines[i];
				}
				// caching the search string in advance fixes the problem: 
				// cannot get the selection when opening popup with popupType = tooltip
				popup.setAttribute("_moz-selectedtext", getBrowserSelection());
				break;
			case "FireGestures:CustomPopup": 
				for each (var aAttrs in aAttrsList) {
					var menuitem;
					if (!aAttrs) {
						menuitem = document.createElement("menuseparator");
					}
					else {
						menuitem = document.createElement("menuitem");
						for (var [name, val] in Iterator(aAttrs)) {
							menuitem.setAttribute(name, val);
						}
					}
					popup.appendChild(menuitem);
				}
				break;
		}
		if (activeItem)
			// emphasis the default selection
			activeItem.setAttribute("default", "true");
		else
			// regard the first item as the default
			activeItem = popup.firstChild;
		if (aWheelGesture) {
			this._popupActiveItem = activeItem;
			// setting _moz-menuactive of menuitem after popupshown otherwise it has no effect
			popup.addEventListener("popupshown", this, true);
		}
		document.popupNode = null;
		document.tooltipNode = null;
		popup.addEventListener("popupshowing", this, true);
		popup.addEventListener("popuphiding", this, true);
		popup.addEventListener("DOMMenuItemActive", this, false);
		popup.addEventListener("DOMMenuItemInactive", this, false);
		this._gestureHandler.openPopupAtPointer(popup);
		document.documentElement.addEventListener("mouseup", this, true);
		if (aWheelGesture) {
			document.documentElement.addEventListener("DOMMouseScroll", this, true);
			popup.addEventListener("mouseover", this, false);
		}
	},

	handleEvent: function(event) {
		// dump("FireGestures.handleEvent(" + event.type + ") " + new Date().toString() + "\n");	// #debug
		var popup = document.getElementById("FireGesturesPopup");
		switch (event.type) {
			case "DOMMouseScroll": 
				// prevent scrolling content and propagating to xdIGestureHandler
				event.preventDefault();
				event.stopPropagation();
				// change the active menuitem
				this._activateMenuItem(false);
				var activeItem = this._popupActiveItem;
				activeItem = event.detail > 0 ? activeItem.nextSibling : activeItem.previousSibling;
				if (!activeItem)
					activeItem = event.detail > 0 ? popup.firstChild : popup.lastChild;
				this._popupActiveItem = activeItem;
				this._activateMenuItem(true);
				// autoscroll to ensure the active menuitem is visible
				var scrollbox = document.getAnonymousNodes(popup)[0];
				scrollbox.ensureElementIsVisible(activeItem);
				break;
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
			case "mouseover": 
				if (event.target.parentNode != popup)
					break;
				this._activateMenuItem(false);
				this._popupActiveItem = event.target;
				this._activateMenuItem(true);
				break;
			case "mouseup": 
				// do something for the active menuitem
				// if invoked by wheelgesture, get it from _popupActiveItem
				// if invoked by mousegesture, get it from event.target since _popupActiveItem is null
				var activeItem = this._popupActiveItem || event.target;
				if (activeItem.localName == "menuitem" && !activeItem.hasAttribute("default")) {
					switch (popup.getAttribute("_moz-gesturecommand")) {
						case "FireGestures:AllTabsPopup": 
							gBrowser.selectedTab = gBrowser.mTabs[activeItem.index];
							break;
						case "FireGestures:BFHistoryPopup": 
							gBrowser.webNavigation.gotoIndex(activeItem.index);
							break;
						case "FireGestures:ClosedTabsPopup": 
							undoCloseTab(activeItem.index);
							break;
						case "FireGestures:WebSearchPopup": 
							var selText = popup.getAttribute("_moz-selectedtext");
							var engine = activeItem.engine;
							if (!engine)
								break;
							var submission = engine.getSubmission(selText, null);
							if (!submission)
								break;
							gBrowser.loadOneTab(submission.uri.spec, {
								postData: submission.postData,
								relatedToCurrent: true
							});
							break;
						default: 
							eval(activeItem.getAttribute("oncommand"));
					}
				}
				popup.hidePopup();
				break;
			case "popupshowing": 
				// [Linux] this needs to fire DOMMouseScroll events outside popup
				var boxObj = popup.popupBoxObject;
				if ("setConsumeRollupEvent" in boxObj) {
					boxObj.setConsumeRollupEvent(boxObj.ROLLUP_NO_CONSUME);
					// dump("*** nsIPopupBoxObject#setConsumeRollupEvent(ROLLUP_NO_CONSUME)\n");	// #debug
				}
				break;
			case "popupshown": 
				this._activateMenuItem(true);
				break;
			case "popuphiding": 
				this._activateMenuItem(false);
				this._popupActiveItem = null;
				popup.removeEventListener("popupshowing", this, true);
				popup.removeEventListener("popupshown", this, true);
				popup.removeEventListener("popuphiding", this, true);
				popup.removeEventListener("mouseover", this, false);
				document.documentElement.removeEventListener("mouseup", this, true);
				document.documentElement.removeEventListener("DOMMouseScroll", this, true);
				while (popup.hasChildNodes())
					popup.removeChild(popup.lastChild);
				break;
		}
	},

	_activateMenuItem: function(aActive) {
		if (!this._popupActiveItem)
			return;
		if (aActive)
			this._popupActiveItem.setAttribute("_moz-menuactive", "true");
		else
			this._popupActiveItem.removeAttribute("_moz-menuactive");
		if (this._isMac) {
			// [Mac]
			if (aActive) {
				var cssText = "background-color: -moz-menuhover; color: -moz-menuhovertext;";
				this._popupActiveItem.setAttribute("style", cssText);
			}
			else
				this._popupActiveItem.removeAttribute("style");
		}
		// dispatch event to show statustext
		var evt = document.createEvent("Events");
		evt.initEvent(aActive ? "DOMMenuItemActive" : "DOMMenuItemInactive", true, true);
		this._popupActiveItem.dispatchEvent(evt);
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


