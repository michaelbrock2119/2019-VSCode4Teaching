import * as vscode from "vscode";
import { APIClient } from "../../client/APIClient";
import { CurrentUser } from "../../client/CurrentUser";
import { Course, instanceOfCourse } from "../../model/serverModel/course/Course";
import { instanceOfExercise } from "../../model/serverModel/exercise/Exercise";
import { ModelUtils } from "../../model/serverModel/ModelUtils";
import { User } from "../../model/serverModel/user/User";
import { UserSignup } from "../../model/serverModel/user/UserSignup";
import { FileZipUtil } from "../../utils/FileZipUtil";
import { UserPick } from "./UserPick";
import { V4TBuildItems } from "./V4TItem/V4TBuiltItems";
import { V4TItem } from "./V4TItem/V4TItem";
import { V4TItemType } from "./V4TItem/V4TItemType";
import { Validators } from "./Validators";

/**
 * Tree view that lists extension's basic options like:
 * - Log in
 * - Sign up
 * - Courses actions
 * - Exercises actions
 */
export class CoursesProvider implements vscode.TreeDataProvider<V4TItem> {

    /**
     * Update tree view. Use when there are changes that should be reflected on the view.
     * Calls getChildren() and displays returned elements onto the view
     * @param item Item passed to getChildren()
     */
    public static triggerTreeReload(item?: V4TItem) {
        CoursesProvider.onDidChangeTreeDataEventEmitter.fire(item);
    }

    private static onDidChangeTreeDataEventEmitter: vscode.EventEmitter<V4TItem | undefined> = new vscode.EventEmitter<V4TItem | undefined>();
    public readonly onDidChangeTreeData?: vscode.Event<V4TItem | null | undefined> = CoursesProvider.onDidChangeTreeDataEventEmitter.event;
    private defaultServer: string = vscode.workspace.getConfiguration("vscode4teaching").get("defaultServer", "");
    private loading = false;

    /**
     * Get parent of element
     * @param element element
     */
    public getParent(element: V4TItem) {
        return element.parent;
    }

    /**
     * Get tree item of element
     * @param element element
     */
    public getTreeItem(element: V4TItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    /**
     * Get elements of the view.
     * If element is undefined and user is not logged in it will show login and signup (student).
     * If element is undefined and user is logged in it will show the user's course buttons and, if the user is a student, it will show "get course with code".
     * If element is a course it will show its exercises below it.
     * These buttons have commands attached to them that will be handled in extension.ts.
     * Check also the package.json for other contributed actions on these buttons (like edit, delete, etc.).
     * @param element
     */
    public getChildren(element?: V4TItem | undefined): vscode.ProviderResult<V4TItem[]> {
        let treeElements: V4TItem[] = [];
        if (!this.loading) {
            if (element) {
                // Only collapsable items are courses
                return this.getExerciseButtons(element);
            } else {
                // If not logged add login button, else show courses
                if (!CurrentUser.isLoggedIn()) {
                    try {
                        const sessionInitialized = APIClient.initializeSessionFromFile();
                        if (sessionInitialized) {
                            treeElements = this.updateUserInfo();
                        } else {
                            treeElements = [V4TBuildItems.LOGIN_ITEM, V4TBuildItems.SIGNUP_ITEM];
                        }
                    } catch (error) {
                        return [V4TBuildItems.LOGIN_ITEM, V4TBuildItems.SIGNUP_ITEM];
                    }
                } else {
                    treeElements = this.getCourseButtonsWithUserinfo();
                }
            }
        }
        return treeElements;
    }

    /**
     * Show form to get user data for logging in, then call client to log in.
     */
    public async login() {
        // Ask for server url, then username, then password, and try to log in at the end
        const url: string | undefined = await this.getInput("Server", Validators.validateUrl, { value: this.defaultServer });
        if (url) {
            const username: string | undefined = await this.getInput("Username", Validators.validateUsername);
            if (username) {
                const password: string | undefined = await this.getInput("Password", Validators.validatePasswordLogin, { password: true });
                if (password) {
                    APIClient.loginV4T(username, password, url).then(() => {
                        // Maybe do something?
                    }).catch((error) => {
                        APIClient.handleAxiosError(error);
                    });
                }
            }
        }
    }

    /**
     * Show form for signing up then call client.
     * @param isTeacher sign up as teacher if true, else sign up as student.
     */
    public async signup(isTeacher?: boolean) {
        let url: string;
        let userCredentials: UserSignup = {
            username: "",
            password: "",
            email: "",
            name: "",
            lastName: "",
        };
        const userUrl = await this.getInput("Server", Validators.validateUrl, { value: this.defaultServer });
        if (userUrl) {
            url = userUrl;
            const username = await this.getInput("Username", Validators.validateUsername);
            if (username) {
                userCredentials = Object.assign(userCredentials, { username });
                const password = await this.getInput("Password", Validators.validatePasswordSignup, { password: true });
                if (password) {
                    userCredentials = Object.assign(userCredentials, { password });
                    Validators.valueToCompare = password;
                    const confirmPassword = await this.getInput("Confirm password", Validators.validateEqualPassword, { password: true });
                    if (confirmPassword) {
                        const email = await this.getInput("Email", Validators.validateEmail);
                        if (email) {
                            userCredentials = Object.assign(userCredentials, { email });
                            const name = await this.getInput("Name", Validators.validateName);
                            if (name) {
                                userCredentials = Object.assign(userCredentials, { name });
                                const lastName = await this.getInput("Last name", Validators.validateLastName);
                                if (lastName) {
                                    userCredentials = Object.assign(userCredentials, { lastName });
                                    await APIClient.signUpV4T(userCredentials, url, isTeacher);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    /**
     * Log out current user.
     */
    public logout() {
        APIClient.invalidateSession();
        CoursesProvider.triggerTreeReload();
    }

    /**
     * Show form for adding course then call client.
     */
    public async addCourse() {
        try {
            const courseName = await this.getInput("Course name", Validators.validateCourseName);
            if (courseName) {
                await APIClient.addCourse({ name: courseName });
                await CurrentUser.updateUserInfo();
                CoursesProvider.triggerTreeReload();
            }
        } catch (error) {
            // Only axios requests throw error
            APIClient.handleAxiosError(error);
        }

    }

    /**
     * Show form for editing course then call client.
     * @param item course to edit.
     */
    public async editCourse(item: V4TItem) {
        if (item.item && "exercises" in item.item) {
            try {
                const newCourseName = await this.getInput("Course name", Validators.validateCourseName);
                if (newCourseName && CurrentUser.isLoggedIn() && CurrentUser.getUserInfo().courses) {
                    await APIClient.editCourse(item.item.id, { name: newCourseName });
                    await CurrentUser.updateUserInfo();
                    CoursesProvider.triggerTreeReload();
                }
            } catch (error) {
                // Only axios requests throw error
                APIClient.handleAxiosError(error);
            }
        }
    }

    /**
     * Show warning prompt to delete course, then call client.
     * @param item course to delete
     */
    public async deleteCourse(item: V4TItem) {
        if (item.item && instanceOfCourse(item.item)) {
            try {
                const selectedOption = await vscode.window.showWarningMessage("Are you sure you want to delete " + item.item.name + "?", { modal: true }, "Accept");
                if ((selectedOption === "Accept") && CurrentUser.isLoggedIn() && CurrentUser.getUserInfo().courses) {
                    await APIClient.deleteCourse(item.item.id);
                    await CurrentUser.updateUserInfo();
                    CoursesProvider.triggerTreeReload();
                }
            } catch (error) {
                // Only axios requests throw error
                APIClient.handleAxiosError(error);
            }
        }
    }

    /**
     * Refreshes current available courses.
     */
    public refreshCourses() {
        if (CurrentUser.isLoggedIn()) {
            // If not logged refresh shouldn't do anything
            CurrentUser.updateUserInfo().then(() => {
                CoursesProvider.triggerTreeReload();
            }).catch((error) => {
                APIClient.handleAxiosError(error);
            });
        }
    }

    /**
     * Refreshes current available exercises of course
     * @param item course
     */
    public refreshExercises(item: V4TItem) {
        CoursesProvider.triggerTreeReload(item);
    }

    /**
     * Show form for adding an exercise then call client.
     * @param item course
     */
    public async addExercise(item: V4TItem) {
        if (item.item && instanceOfCourse(item.item)) {
            // Get exercise name
            const name = await this.getInput("Exercise name", Validators.validateExerciseName);
            if (name) {
                // Select files to use as template for the exercise
                const fileUris = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: true,
                    canSelectMany: true,
                });
                if (fileUris) {
                    // Create zip file from files and send them
                    const course: Course = item.item;
                    try {
                        const addExerciseData = await APIClient.addExercise(course.id, { name });
                        try {
                            // When exercise is createdupload template
                            const zipContent = await FileZipUtil.getZipFromUris(fileUris);
                            await APIClient.uploadExerciseTemplate(addExerciseData.data.id, zipContent);
                            CoursesProvider.triggerTreeReload(item);
                        } catch (uploadError) {
                            try {
                                // If upload fails delete the exercise and show error
                                await APIClient.deleteExercise(addExerciseData.data.id);
                                APIClient.handleAxiosError(uploadError);
                            } catch (deleteError) {
                                APIClient.handleAxiosError(deleteError);
                            }
                        }
                    } catch (error) {
                        APIClient.handleAxiosError(error);
                    }
                }
            }
        }
    }

    /**
     * Show form for editing an exercise then call client.
     * @param item exercise
     */
    public async editExercise(item: V4TItem) {
        if (item.item && instanceOfExercise(item.item)) {
            const name = await this.getInput("Exercise name", Validators.validateExerciseName);
            if (name) {
                try {
                    await APIClient.editExercise(item.item.id, { name });
                    CoursesProvider.triggerTreeReload(item.parent);
                    vscode.window.showInformationMessage("Exercise edited successfully");
                } catch (error) {
                    APIClient.handleAxiosError(error);
                }
            }
        }
    }

    /**
     * Show warning prompt for deleting exercise then call client.
     * @param item exercise
     */
    public async deleteExercise(item: V4TItem) {
        if (item.item && instanceOfExercise(item.item)) {
            try {
                const selectedOption = await vscode.window.showWarningMessage("Are you sure you want to delete " + item.item.name + "?", { modal: true }, "Accept");
                if (selectedOption === "Accept") {
                    await APIClient.deleteExercise(item.item.id);
                    CoursesProvider.triggerTreeReload(item.parent);
                    vscode.window.showInformationMessage("Exercise deleted successfully");
                }
            } catch (error) {
                // Only axios requests throw error
                APIClient.handleAxiosError(error);
            }
        }
    }

    /**
     * Show list of users to add to course
     * @param item course
     */
    public async addUsersToCourse(item: V4TItem) {
        if (item.item && instanceOfCourse(item.item)) {
            try {
                // Get all users available
                const usersResponse = await APIClient.getAllUsers();
                const users: User[] = usersResponse.data;
                // Get users currently in course
                const courseUsersResponse = await APIClient.getUsersInCourse(item.item.id);
                const courseUsers = courseUsersResponse.data;
                // Remove from the list the users that are already in the course
                const showArray = users.filter((user: User) => courseUsers.filter((courseUser: User) => courseUser.id === user.id).length === 0)
                    .map((user: User) => {
                        // Get pickable items from users
                        return this.userPickFromUser(user);
                    });
                const ids = await this.manageUsersFromCourse(showArray, item);
                if (ids) {
                    await APIClient.addUsersToCourse(item.item.id, { ids });
                }
            } catch (error) {
                APIClient.handleAxiosError(error);
            }
        }
    }

    /**
     * Show list of users to remove from course
     * @param item course
     */
    public async removeUsersFromCourse(item: V4TItem) {
        if (item.item && instanceOfCourse(item.item)) {
            try {
                // Get users in course
                const courseUsersResponse = await APIClient.getUsersInCourse(item.item.id);
                const creatorResponse = await APIClient.getCreator(item.item.id);
                const creator: User = creatorResponse.data;
                const courseUsers = courseUsersResponse.data;
                // Remove creator of course from list
                const showArray = courseUsers.filter((user: User) => user.id !== creator.id).map((user: User) => {
                    // Get pickable items from users
                    return this.userPickFromUser(user);
                });
                const ids = await this.manageUsersFromCourse(showArray, item);
                if (ids) {
                    await APIClient.removeUsersFromCourse(item.item.id, { ids });
                }
            } catch (error) {
                APIClient.handleAxiosError(error);
            }
        }
    }

    /**
     * Shows code input box, calls client and adds new course to the list
     */
    public async getCourseWithCode() {
        const code = await this.getInput("Introduce sharing code", Validators.validateSharingCode);
        if (code) {
            try {
                const response = await APIClient.getCourseWithCode(code);
                const course: Course = response.data;
                CurrentUser.addNewCourse(course);
                CoursesProvider.triggerTreeReload();
            } catch (error) {
                APIClient.handleAxiosError(error);
            }
        }
    }
    /**
     * Create exercise buttons from exercises.
     * @param element course
     */
    private async getExerciseButtons(element: V4TItem): Promise<V4TItem[]> {
        const course = element.item;
        await this.getExercises(element);
        if (course && instanceOfCourse(course)) {
            // If exercises were downloaded previously show them, else get them from server
            if (course.exercises.length > 0) {
                // Map exercises to TreeItems
                let type: V4TItemType;
                let commandName: string;
                if (CurrentUser.isLoggedIn() && ModelUtils.isTeacher(CurrentUser.getUserInfo())) {
                    type = V4TItemType.ExerciseTeacher;
                    commandName = "vscode4teaching.getstudentfiles";
                } else {
                    type = V4TItemType.ExerciseStudent;
                    commandName = "vscode4teaching.getexercisefiles";
                }
                const exerciseItems = course.exercises.map((exercise) => new V4TItem(exercise.name, type, vscode.TreeItemCollapsibleState.None, element, exercise, {
                    command: commandName,
                    title: "Get exercise files",
                    arguments: [course ? course.name : null, exercise],
                }));
                return exerciseItems.length > 0 ? exerciseItems : [V4TBuildItems.NO_EXERCISES_ITEM];
            }
        }
        return [V4TBuildItems.NO_EXERCISES_ITEM];
    }

    /**
     * Create course buttons from courses.
     */
    private updateUserInfo(): V4TItem[] {
        this.loading = true;
        CurrentUser.updateUserInfo().then(() => {
            // Calls getChildren again, which will go through the else statement in this method (logged in and user info initialized)
            CoursesProvider.triggerTreeReload();
        }).catch((error) => {
            APIClient.handleAxiosError(error);
            CoursesProvider.triggerTreeReload();
        },
        ).finally(() => {
            this.loading = false;
        });
        return [];
    }

    /**
     * Create buttons from courses
     */
    private getCourseButtonsWithUserinfo() {
        const userinfo = CurrentUser.getUserInfo();
        if (userinfo.courses) {
            const isTeacher = ModelUtils.isTeacher(userinfo);
            let type: V4TItemType;
            type = isTeacher ? V4TItemType.CourseTeacher : V4TItemType.CourseStudent;
            // From courses create buttons
            const items = userinfo.courses.map((course) => new V4TItem(course.name, type, vscode.TreeItemCollapsibleState.Collapsed, undefined, course));
            // Add 'add course' button if user is teacher
            if (isTeacher) {
                items.unshift(V4TBuildItems.ADD_COURSES_ITEM);
                items.push(V4TBuildItems.SIGNUP_TEACHER_ITEM);
            }
            if (ModelUtils.isStudent(userinfo)) {
                items.unshift(V4TBuildItems.GET_WITH_CODE_ITEM);
            }
            items.push(V4TBuildItems.LOGOUT_ITEM);
            return items;
        }
        return [V4TBuildItems.NO_COURSES_ITEM];
    }

    /**
     * Creates input box with validation
     * @param prompt prompt
     * @param validator validator (check model/Validators.ts)
     * @param options available options for input box
     */
    private async getInput(prompt: string, validator: ((value: string) => string | undefined | null | Thenable<string | undefined | null>), options?: { value?: string, password?: boolean }) {
        let inputOptions: vscode.InputBoxOptions = { prompt };
        if (options) {
            if (options.value) {
                inputOptions = Object.assign(inputOptions, { value: options.value });
            }
            if (options.password) {
                inputOptions = Object.assign(inputOptions, { password: options.password });
            }
        }
        inputOptions.validateInput = validator;
        return vscode.window.showInputBox(inputOptions);
    }

    /**
     * Gets exercise from server and add them to course
     * @param item course
     */
    private async getExercises(item: V4TItem) {
        const course = item.item;
        if (instanceOfCourse(course)) {
            const exercisesThenable = APIClient.getExercises(course.id);
            try {
                const response = await exercisesThenable;
                course.exercises = response.data;
            } catch (error) {
                APIClient.handleAxiosError(error);
            }
        }
    }

    /**
     * Creates selectable pick items from user
     * @param user user
     */
    private userPickFromUser(user: User) {
        let displayName = user.name && user.lastName ? user.name + " " + user.lastName : user.username;
        if (ModelUtils.isTeacher(user)) {
            displayName += " (Teacher)";
        }
        return new UserPick(displayName, user);
    }

    /**
     * Converts picked items to id array to call client with client call selected (thenable)
     * @param showArray picked items
     * @param item course
     * @param thenableFunction thenable to call
     */
    private async manageUsersFromCourse(showArray: UserPick[], item: V4TItem) {
        if (item.item && instanceOfCourse(item.item)) {
            // Show users that don't belong to the course already
            if (showArray.length > 0) {
                const picks: UserPick[] | undefined = await vscode.window.showQuickPick<UserPick>(showArray, { canPickMany: true });
                if (picks) {
                    const ids: number[] = [];
                    picks.forEach((pick) => ids.push(pick.user.id));
                    return ids;
                }
            } else {
                vscode.window.showInformationMessage("There are no users available.");
            }
        }
    }
}
