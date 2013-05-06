//////////////////////////////////////////////////
// global

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

const TYPE_CATEGORY = Ci.xdIGestureMapping.TYPE_CATEGORY;
const TYPE_NORMAL   = Ci.xdIGestureMapping.TYPE_NORMAL;
const TYPE_SCRIPT   = Ci.xdIGestureMapping.TYPE_SCRIPT;

const kTypeCol      = 0;
const kNameCol      = 1;
const kCommandCol   = 2;
const kDirectionCol = 3;
const kFlagsCol     = 4;

const kExtraArray1 = [
	["wheelGestureU",  "wheel-up"    ],
	["wheelGestureD",  "wheel-down"  ],
	["rockerGestureL", "rocker-left" ],
	["rockerGestureR", "rocker-right"],
	["swipeGestureL",  "swipe-left"  ],
	["swipeGestureR",  "swipe-right" ],
	["swipeGestureU",  "swipe-up"    ],
	["swipeGestureD",  "swipe-down"  ],
];

const kExtraArray2 = [
	["keypressGestureC", "keypress-ctrl" ],
	["keypressGestureS", "keypress-shift"],
];

const FG_TYPE_ATTR = "_command-type";
const DRAGDROP_FLAVOR = "text/x-moz-tree-index";
const TYPE_X_MOZ_URL = "text/x-moz-url";

const APP_VERSION = parseFloat(Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo).version);

// arrayfied mapping
var gMappingArray = [];
// nsITreeView
var gMappingView = null;
// flag indicates that mapping should be saved
var gShouldCommit = false;

function getElement(aId) document.getElementById(aId);


//////////////////////////////////////////////////
// PrefsUI

var PrefsUI = {

	// xdIGestureService
	_gestureSvc: null,

	// xdIGestureMapping
	_gestureMapping: null,

	get promptSvc() {
		delete this.promptSvc;
		return this.promptSvc = Cc["@mozilla.org/embedcomp/prompt-service;1"].
		                        getService(Ci.nsIPromptService);
	},

	// [Linux] NOTE: very high CPU usage if init is called on prefpane@onpaneload
	init: function() {
		this._gestureSvc = Cc["@xuldev.org/firegestures/service;1"].getService(Ci.xdIGestureService);
		if ("arguments" in window) {
			this._gestureMapping = this._gestureSvc.getMapping(window.arguments[0]);
			document.title = this._gestureMapping.name + " : " + document.title;
			document.documentElement.setAttribute("windowtype", window.name);
		}
		else
			this._gestureMapping = this._gestureSvc.getMappingForBrowser();
		gMappingArray = this._gestureMapping.getMappingArray();
		gMappingArray = gMappingArray.filter(function(item) {
			// check flags and exclude the following items
			// * dummy items for keypress gestures
			// * items which do not support the current version of Firefox
			var flags = item[kFlagsCol];
			if (flags && flags.indexOf("hidden") >= 0)
				return false;
			if (flags && /^min:firefox([\d\.]+)$/.test(flags) && parseFloat(RegExp.$1) > APP_VERSION)
				return false;
			if (flags && /^max:firefox([\d\.]+)$/.test(flags) && parseFloat(RegExp.$1) < APP_VERSION)
				return false;
			// exclude items which are assigned extra gestures
			return /^[LRUD]*$/.test(item[kDirectionCol]);
		});
		// init nsITreeView
		var mappingTree = getElement("mappingTree");
		gMappingView = new CustomTreeView();
		mappingTree.view = gMappingView;
		this.updateCommands();
		this.rebuildExtraMenus1();
		this.rebuildExtraMenus2();
		if (("arguments" in window == false) && 
		    (navigator.platform.indexOf("Mac") < 0 || !document.documentElement.instantApply)) {
			// move 'Get Scripts' to bottom-left corner of window except [Mac] + instantApply=true
			var buttons = document.documentElement.getButton("accept").parentNode;
			buttons.insertBefore(getElement("getScripts"), buttons.firstChild);
		}
		// [Windows7] fix 1px black border at the right of window
		window.sizeToContent();
	},

	done: function() {
		if (gShouldCommit) {
			// wheel gestures and rocker gestures and swipe gestures
			for (let [id, direction] of kExtraArray1) {
				var menuList = getElement(id);
				var type = parseInt(menuList.selectedItem.getAttribute(FG_TYPE_ATTR), 10);
				gMappingArray.push([type, menuList.label, menuList.value, direction]);
			}
			// keypress gesture
			for (let [id, direction] of kExtraArray2) {
				var menuList = getElement(id);
				gMappingArray.push([TYPE_NORMAL, menuList.label, menuList.value, direction]);
			}
			// gMappingArray.forEach(function(aItem) { dump(aItem.toString() + "\n"); });	// #debug
			// flush the dumped mapping to file
			try {
				this._gestureMapping.saveUserMapping(gMappingArray);
			}
			catch(ex) {
				var msg = "An error occurred while saving gesture mappings.\n\n" + ex;
				this.promptSvc.alert(window, "FireGestures", msg);
			}
		}
		this._gestureMapping = null;
		this._gestureSvc = null;
	},

	// populate menu for wheel gestures and rocker gestures and swipe gestures
	rebuildExtraMenus1: function() {
		dump("rebuildExtraMenus1\n");	// #debug
		for (let [id, direction] of kExtraArray1) {
			var menuList = getElement(id);
			var commandName  = null;
			var commandValue = null;
			if (menuList.itemCount == 0) {
				// first-time population
				var command = this._gestureMapping.getCommandForDirection(direction);
				if (command) {
					commandName  = command.name;
					commandValue = command.value;
				}
				dump("(1) " + commandName + "\n");	//# debug
			}
			else {
				commandName  = menuList.selectedItem.label;
				commandValue = menuList.selectedItem.value;
				menuList.removeAllItems();
				dump("(2+) " + commandName + "\n");	// #debug
			}
			// append '...' item
			menuList.appendItem("...", "").setAttribute(FG_TYPE_ATTR, TYPE_NORMAL);
			var selItem = null;
			for (let [type, name, command] of gMappingArray) {
				if (type == TYPE_CATEGORY) {
					var newItem = getElement("separatorTemplate").cloneNode(true);
					newItem.id = null;
					newItem.firstChild.setAttribute("value", name);
					menuList.menupopup.appendChild(newItem);
				}
				else {
					var newItem = menuList.appendItem(name, command);
					newItem.setAttribute(FG_TYPE_ATTR, type);
					if ((commandName || commandValue) && !selItem) {
						// if type is TYPE_NORMAL, select a menuitem which has same command
						// if type is TYPE_SCRIPT, select a menuitem which has same name
						if ((type == TYPE_NORMAL && command == commandValue) || 
						    (type == TYPE_SCRIPT && name == commandName))
							selItem = newItem;
					}
				}
			}
			menuList.selectedItem = selItem || menuList.getItemAtIndex(0);
		}
	},

	// populate menu for keypress gestures
	rebuildExtraMenus2: function() {
		dump("rebuildExtraMenus2\n");	// #debug
		for (let [id, direction] of kExtraArray2) {
			var menuList = getElement(id);
			var command = this._gestureMapping.getCommandForDirection(direction);
			if (!command)
				// select '...' item
				continue;
			// find and select menuitem which has the specified value attribute
			var elts = menuList.getElementsByAttribute("value", command.value);
			if (elts.length > 0)
				menuList.selectedItem = elts[0];
		}
	},

	updateMouseGestureUIGroup: function() {
		// if mouse gesture is enabled...
		//   1) disable all UI in 'mousegesture' group
		// if mouse gesture is disabled...
		//   1) enable all UI in 'mousegesture' group
		//   2) enable/disable each sub-groups in 'mousegesture' group
		this.updateUIGroup("mousegesture");
		if (getElement("pref:mousegesture").value) {
			this.updateUIGroup("trail");
			this.updateUIGroup("status");
			this.updateUIGroup("timeout");
		}
	},

	updateSwipeGestureUIGroup: function() {
		this.updateUIGroup("swipegesture");
		if (getElement("pref:swipegesture").value) {
			this.updateUIGroup("swipetimeout");
			// enable/disable single swipe UI
			var enable = getElement("pref:swipetimeout").value == 0;
			var elts = document.querySelectorAll('[uigroup="swipegesture"] > grid *');
			Array.forEach(elts, function(elt) {
				elt.disabled = !enable;
			});
		}
	},

	updateUIGroup: function(aGroupName) {
		var pref = getElement(aGroupName).getAttribute("preference");
		var val = getElement(pref).value;
		// val is a number, if gesture_timeout is changed from checkbox
		// val is a string, if gesture_timeout is changed from textbox
		var enable = false;
		switch (typeof(val)) {
			case "boolean": enable = val;
			case "number" : enable = val != 0;
			case "string" : enable = val != "0";
		}
		// dump(aGroupName + "\t" + val + "\t" + enable + "\n");
		var elts = document.querySelectorAll("[uigroup=" + aGroupName + "] *");
		Array.forEach(elts, function(elt) {
			if (elt.id != aGroupName)
				elt.disabled = !enable;
			// this fixes the problem: colorpicker looks active even if setting disabled to true
			if (elt.localName == "colorpicker" || elt.id == "trailSample")
				elt.style.opacity = enable ? 1 : 0.5;
		});
		if (aGroupName == "trail")
			this.updateTrail();
	},

	updateTriggerButton: function() {
		var button = getElement("pref:triggerbutton").value;
		["wheelUpLabel", "wheelDownLabel"].forEach(function(id) {
			var label = getElement(id);
			label.value = label.getAttribute("value" + button);
		});
		window.sizeToContent();
	},

	updateTrail: function() {
		var enabled = getElement("pref:trail").value;
		var color   = getElement("pref:trailcolor").value;
		var size    = getElement("pref:trailsize").value;
		var sample = getElement("trailSample");
		sample.style.borderColor = color;
		sample.style.borderWidth = size.toString() + "px";
		if (enabled)
			getElement("trailButtons").decreaseDisabled = (size <= 1);
	},

	changeTrailSize: function(aIncrement) {
		var pref = getElement("pref:trailsize");
		pref.value = pref.value + aIncrement > 0 ? pref.value + aIncrement : 1;
		this.updateTrail();
	},

	generateMappingsMenu: function(event) {
		var menuPopup = event.target;
		if (menuPopup.hasAttribute("_generated"))
			return;
		menuPopup.setAttribute("_generated", "true");
		for (let { id: id, name: name } of this._gestureSvc.getMappingsInfo()) {
			var menuItem = document.createElement("menuitem");
			menuItem.setAttribute("id", id);
			menuItem.setAttribute("label", name);
			menuPopup.appendChild(menuItem);
		}
	},

	backupMappings: function(aMenuItem) {
		var dbConn = this._gestureSvc.getDBConnection(false);
		if (!dbConn)
			return;
		var filePicker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
		filePicker.init(window, aMenuItem.getAttribute("title"), filePicker.modeSave);
		filePicker.appendFilter("SQLite", "*.sqlite");
		var dirSvc = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties);
		filePicker.displayDirectory = dirSvc.get("Desk", Ci.nsILocalFile);
		var date = new Date().toLocaleFormat("%Y-%m-%d");
		filePicker.defaultString = dbConn.databaseFile.leafName.replace(".", "-" + date + ".");
		if (filePicker.show() == filePicker.returnCancel || !filePicker.file)
			return;
		var file = filePicker.file.QueryInterface(Ci.nsILocalFile);
		this._gestureSvc.backupMappings(file);
	},

	restoreMappings: function(aMenuItem) {
		var filePicker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
		filePicker.init(window, aMenuItem.getAttribute("title"), filePicker.modeOpen);
		filePicker.appendFilter("SQLite", "*.sqlite");
		if (filePicker.show() == filePicker.returnCancel || !filePicker.file)
			return;
		if (!this.promptSvc.confirm(window, "FireGestures", aMenuItem.getAttribute("alerttext")))
			return;
		var file = filePicker.file.QueryInterface(Ci.nsILocalFile);
		this._gestureSvc.restoreMappings(file);
	},

	handleTreeEvent: function(event) {
		switch (event.type) {
			case "dblclick": 
				// start editing the gesture with double-click
				if (event.target.localName == "treechildren")
				this.doCommand("cmd_edit_gesture");
				break;
			case "keypress": 
				switch (event.keyCode) {
					// Enter key: edit gesture
					case event.DOM_VK_RETURN: 
						this.doCommand("cmd_edit_gesture");
						break;
					// Delete key: clear gesture
					case event.DOM_VK_DELETE: 
						this.doCommand("cmd_clear_gesture");
						break;
					default: return;
				}
				event.preventDefault();
				break;
			case "dragstart": 
				var selIdxs = gMappingView.getSelectedIndexes();
				// prevent dragging multiple items at once
				if (selIdxs.length != 1)
					return;
				// prevent dragging non-script-type commands
				var sourceIndex = selIdxs[0];
				if (gMappingArray[sourceIndex][kTypeCol] != TYPE_SCRIPT)
					return;
				// generate transfer data
				event.dataTransfer.setData(DRAGDROP_FLAVOR, sourceIndex);
				event.dataTransfer.dropEffect = "move";
				break;
			case "dragenter": 
			case "dragover": 
				if (event.dataTransfer.types.contains(TYPE_X_MOZ_URL))
					event.preventDefault();
				break;
			case "drop": 
				const URL_PREFIX = "data:text/javascript,";
				var lines = event.dataTransfer.getData(TYPE_X_MOZ_URL).split("\n");
				if (lines.length != 2 || lines[0].indexOf(URL_PREFIX) != 0)
					return;
				lines[0] = decodeURIComponent(lines[0].substr(URL_PREFIX.length));
				gMappingView.appendItem([TYPE_SCRIPT, lines[1], lines[0], ""]);
				PrefsUI.rebuildExtraMenus1();
				gShouldCommit = true;
				break;
			default: 
		}
	},

	updateCommands: function() {
		var idxs = gMappingView.getSelectedIndexes();
		// enable 'Edit' button if there is at least one non-separator selected item
		var canEdit = idxs.length > 0;
		// enable 'Delete' button if there is at least one script-type command
		// enable 'Clear' button if there is at least one command with a non-empty direction
		var canDelete = false, canClear = false;
		idxs.forEach(function(idx) {
			if (gMappingArray[idx][kTypeCol] == TYPE_SCRIPT)
				canDelete = true;
			if (gMappingArray[idx][kDirectionCol])
				canClear = true;
		});
		var setElementDisabledByID = function(aID, aDisable) {
			if (aDisable)
				getElement(aID).removeAttribute("disabled");
			else
				getElement(aID).setAttribute("disabled", "true");
		};
		setElementDisabledByID("cmd_edit_gesture",  canEdit);
		setElementDisabledByID("cmd_clear_gesture", canClear);
		setElementDisabledByID("cmd_delete_script", canDelete);
	},

	// @param aCommand cmd_add_script    [Add Script]
	//                 cmd_edit_gesture  [Edit]
	//                 cmd_clear_script  [Clear]
	//                 cmd_delete_script [Delete]
	doCommand: function(aCommand) {
		switch (aCommand) {
			case "cmd_add_script": 
				// don't use same name for different scripts as much as possible
				var suggestedName = getElement("bundleMain").getString("NEW_SCRIPT");
				var nums = [0];
				gMappingArray.forEach(function(item) {
					if (item[kNameCol].indexOf(suggestedName) == 0 && /\s\((\d+)\)$/.test(item[kNameCol]))
						nums.push(parseInt(RegExp.$1, 10));
				});
				suggestedName += " (" + (Math.max.apply(this, nums) + 1) + ")";
				// alert(nums.toSource() + "\n" + suggestedName);	// #debug
				var newIdx = gMappingView.appendItem([TYPE_SCRIPT, suggestedName, "", ""]);
				this.editGesture(newIdx, true);
				break;
			case "cmd_edit_gesture" : 
				var idxs = gMappingView.getSelectedIndexes();
				idxs.forEach(function(idx) { this.editGesture(idx, false); }, this);
				break;
			case "cmd_clear_gesture": 
				var idxs = gMappingView.getSelectedIndexes();
				idxs.forEach(function(idx) { gMappingArray[idx][kDirectionCol] = ""; });
				gMappingView.update();
				break;
			case "cmd_delete_script": 
				// with multiple selection in mind, process from the last tree index
				var idxs = gMappingView.getSelectedIndexes();
				for (var i = idxs.length - 1; i >= 0; i--) {
					if (gMappingArray[idxs[i]][kTypeCol] == TYPE_SCRIPT)
						gMappingView.removeItemAt(idxs[i]);
				}
				this.rebuildExtraMenus1();
				break;
		}
		// update commands since select event is not fired after editing / clearing
		this.updateCommands();
		gShouldCommit = true;
	},

	// @param aIdx the tree index
	// @param aIsNewScript true means the first-time editing
	editGesture: function(aIdx, aIsNewScript) {
		var oldCommand   = gMappingArray[aIdx][kCommandCol];
		var oldDirection = gMappingArray[aIdx][kDirectionCol];
		// open dialog
		var ret = {
			type     : gMappingArray[aIdx][kTypeCol],
			name     : gMappingArray[aIdx][kNameCol],
			command  : oldCommand,
			direction: oldDirection,
			accepted : false
		};
		var features = "chrome,modal" + (ret.type == TYPE_SCRIPT ? ",all,resizable" : "");
		document.documentElement.openSubDialog("chrome://firegestures/content/edit.xul", features, ret);
		if (!ret.accepted) {
			// delete a script-type command when editing a new script
			if (aIsNewScript)
				gMappingView.removeItemAt(aIdx);
			return;
		}
		// when clicking on 'No' button in checking duplication
		if (this.checkConflict(ret.direction, aIdx)) {
			// when first-time editing a script, commit it with empty direction
			if (aIsNewScript)
				ret.direction = "";
			// after second-time editing, reset direction and commit it
			else if (oldCommand != ret.command)
				ret.direction = oldDirection;
			// otherwise do nothing
			else
				return;
		}
		// commit
		gMappingArray[aIdx][kDirectionCol] = ret.direction;
		if (ret.type == TYPE_SCRIPT) {
			gMappingArray[aIdx][kNameCol]    = ret.name;
			gMappingArray[aIdx][kCommandCol] = ret.command;
		}
		this.rebuildExtraMenus1();
		// update tree view
		gMappingView.update();
	},

	checkConflict: function(aDirection, aIdx) {
		if (!aDirection)
			return false;
		for (var i = 0; i < gMappingArray.length; i++) {
			var item = gMappingArray[i];
			if (i != aIdx && item[kDirectionCol] == aDirection) {
				// show confirmation dialog
				var msg = getElement("bundleMain").getFormattedString(
					"CONFIRM_CONFLICT",
					[aDirection, item[kNameCol], item[kNameCol]]
				);
				var ret = this.promptSvc.confirmEx(
					window, "FireGestures", msg, this.promptSvc.STD_YES_NO_BUTTONS,
					null, null, null, null, {}
				);
				// 'No' button
				if (ret == 1)
					return true;
				// 'Yes' button
				item[kDirectionCol] = "";
				return false;
			}
		}
		// no duplication detected
		return false;
	},

	openURL: function(aURL) {
		var win = Cc["@mozilla.org/appshell/window-mediator;1"]
		          .getService(Ci.nsIWindowMediator)
		          .getMostRecentWindow("navigator:browser");
		if (win)
			win.gBrowser.loadOneTab(aURL, null, null, null, false, false);
		else
			window.open(aURL);
	}

};


//////////////////////////////////////////////////
// nsITreeView

function CustomTreeView() {}

CustomTreeView.prototype = {

	get atomSvc() {
		var svc = Cc["@mozilla.org/atom-service;1"].getService(Ci.nsIAtomService);
		this.__defineGetter__("atomSvc", function() svc);
		return this.atomSvc;
	},

	// nsITreeBoxObject
	_treeBoxObject: null,

	appendItem: function(aItem) {
		gMappingArray.push(aItem);
		// the index if appended item
		var newIdx = this.rowCount - 1;
		// redraw tree
		this._treeBoxObject.rowCountChanged(newIdx, 1);
		// select the item and focus it
		this.selection.select(newIdx);
		this._treeBoxObject.ensureRowIsVisible(newIdx);
		this._treeBoxObject.treeBody.focus();
		return newIdx;
	},

	removeItemAt: function(aIndex) {
		gMappingArray.splice(aIndex, 1);
		// redraw tree
		this._treeBoxObject.rowCountChanged(aIndex, -1);
	},

	moveItem: function(aSourceIndex, aTargetIndex) {
		var removedItems = gMappingArray.splice(aSourceIndex, 1);
		gMappingArray.splice(aTargetIndex, 0, removedItems[0]);
		gShouldCommit = true;
	},

	update: function() {
		this._treeBoxObject.invalidate();
	},

	// returns array of selected tree indexes (excluding separators)
	getSelectedIndexes: function() {
		var ret = [];
		var sel = this.selection;
		for (var rc = 0; rc < sel.getRangeCount(); rc++) {
			var start = {}, end = {};
			sel.getRangeAt(rc, start, end);
			for (var idx = start.value; idx <= end.value; idx++) {
				if (!this.isSeparator(idx))
					ret.push(idx);
			}
		}
		return ret;
	},

	getSourceIndexFromDrag: function(dataTransfer) {
		if (!dataTransfer.types.contains(DRAGDROP_FLAVOR))
			return -1;
		else
			return parseInt(dataTransfer.getData(DRAGDROP_FLAVOR));
	},

	/* ::::: nsITreeView ::::: */

	get rowCount() {
		return gMappingArray.length;
	},
	selection: null,
	getRowProperties: function(index) {},
	getCellProperties: function(row, col) {},
	getColumnProperties: function(col) {},
	isContainer: function(index) { return false; },
	isContainerOpen: function(index) { return false; },
	isContainerEmpty: function(index) { return false; },
	isSeparator: function(index) {
		return gMappingArray[index][kTypeCol] == TYPE_CATEGORY;
	},
	isSorted: function() { return false; },
	canDrop: function(targetIndex, orientation, dataTransfer) {
		var sourceIndex = this.getSourceIndexFromDrag(dataTransfer);
		// dump("nsITreeView::canDrop(" + sourceIndex + " > " + targetIndex + ", " + orientation + ")\n");	// #debug
		return (
			gMappingArray[targetIndex][kTypeCol] == TYPE_SCRIPT && 
			sourceIndex != -1 && 
			sourceIndex != targetIndex && 
			sourceIndex != (targetIndex + orientation)
		);
	},
	drop: function(targetIndex, orientation, dataTransfer) {
		if (!this.canDrop(targetIndex, orientation, dataTransfer))
			return;
		var sourceIndex = this.getSourceIndexFromDrag(dataTransfer);
		if (sourceIndex == -1)
			return;
		// dump("nsITreeView::drop(" + sourceIndex + " > " + targetIndex + ", " + orientation + ")\n");	// #debug
		if (sourceIndex < targetIndex) {
			if (orientation == Ci.nsITreeView.DROP_BEFORE)
				targetIndex--;
		}
		else {
			if (orientation == Ci.nsITreeView.DROP_AFTER)
				targetIndex++;
		}
		this.moveItem(sourceIndex, targetIndex);
		this.update();
		this.selection.clearSelection();
		this.selection.select(targetIndex);
	},
	getParentIndex: function(rowIndex) { return -1; },
	hasNextSibling: function(rowIndex, afterIndex) { return false; },
	getLevel: function(index) { return 0; },
	getImageSrc: function(row, col) {},
	getProgressMode: function(row, col) {},
	getCellValue: function(row, col) {},
	getCellText: function(row, col) {
		switch (col.index) {
			case 0: return gMappingArray[row][kNameCol];
			case 1: return gMappingArray[row][kCommandCol].replace(/\r|\n|\t/g, " ");
			case 2: return gMappingArray[row][kDirectionCol];
		}
	},
	setTree: function(tree) {
		this._treeBoxObject = tree;
	},
	toggleOpenState: function(index) {},
	cycleHeader: function(col) {},
	selectionChanged: function() {},
	cycleCell: function(row, col) {},
	isEditable: function(row, col) { return false; },
	isSelectable: function(row, col) {},
	setCellValue: function(row, col, value) {},
	setCellText: function(row, col, value) {
		if (col.index == 0)
			gMappingArray[row][kNameCol] = value;
		else if (col.index == 1)
			gMappingArray[row][kCommandCol] = value;
		else if (col.index == 2)
			gMappingArray[row][kDirectionCol] = value;
	},
	performAction: function(action) {},
	performActionOnRow: function(action, row) {},
	performActionOnCell: function(action, row, col) {},

};


