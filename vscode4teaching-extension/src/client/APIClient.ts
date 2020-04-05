import axios, { AxiosPromise } from "axios";
import * as FormData from "form-data";
import * as vscode from "vscode";
import { CoursesProvider } from "../components/courses/CoursesTreeProvider";
import { ServerCommentThread } from "../model/serverModel/comment/ServerCommentThread";
import { Course, instanceOfCourse } from "../model/serverModel/course/Course";
import { CourseEdit } from "../model/serverModel/course/CourseEdit";
import { ManageCourseUsers } from "../model/serverModel/course/ManageCourseUsers";
import { Exercise } from "../model/serverModel/exercise/Exercise";
import { ExerciseEdit } from "../model/serverModel/exercise/ExerciseEdit";
import { FileInfo } from "../model/serverModel/file/FileInfo";
import { User } from "../model/serverModel/user/User";
import { UserSignup } from "../model/serverModel/user/UserSignup";
import { APIClientSession } from "./APIClientSession";
import { AxiosBuildOptions } from "./AxiosBuildOptions";
import { CurrentUser } from "./CurrentUser";

class APIClientSingleton {

    private error401thrown = false;
    private error403thrown = false;

    /**
     * Initialize session from file.
     */
    public initializeSessionFromFile(): boolean {
        return APIClientSession.initializeSessionCredentials();
    }

    /**
     * Invalidates current session.
     */
    public invalidateSession() {
        APIClientSession.invalidateSession();
    }

    /**
     * Logs in to V4T, using the username, password and optionally the server URL.
     * It will save the current session JWTToken, XSRF Token and server Url in a file
     * so it can be used to log in at a future (close in time) time.
     * @param username Username
     * @param password Password
     * @param url Server URL
     */
    public async loginV4T(username: string, password: string, url?: string) {
        try {
            if (url) {
                APIClientSession.invalidateSession();
                APIClientSession.baseUrl = url;
            }
            await this.getXSRFToken();
            const response = await this.login(username, password);
            vscode.window.showInformationMessage("Logged in");
            APIClientSession.jwtToken = response.data.jwtToken;
            APIClientSession.createSessionFile();
            await CurrentUser.updateUserInfo();
            CoursesProvider.triggerTreeReload();
        } catch (error) {
            this.handleAxiosError(error);
        }
    }

    /**
     * Signs up in V4T server.
     * @param userCredentials User to sign up
     * @param url Server URL. Ignored if trying to sign up a teacher.
     * @param isTeacher Sign up as teacher (or not)
     */
    public async signUpV4T(userCredentials: UserSignup, url?: string, isTeacher?: boolean) {
        try {
            if (url && !isTeacher) {
                APIClientSession.invalidateSession();
                APIClientSession.baseUrl = url;
                await this.getXSRFToken();
            }
            let signupThenable;
            if (isTeacher) {
                signupThenable = this.signUpTeacher(userCredentials);
            } else {
                signupThenable = this.signUp(userCredentials);
            }
            await signupThenable;
            if (isTeacher) {
                vscode.window.showInformationMessage("Teacher signed up successfully.");
            } else {
                vscode.window.showInformationMessage("Signed up. Please log in.");
            }
        } catch (error) {
            this.handleAxiosError(error);
        }
    }

    /**
     * Helper method to handle errors provoked by calls to the server.
     * If status code is 401 warns about incorrect log in and invalidates session
     * If status code is 403 xsrf token expired so it gets it again
     * Else or if a previous error repeated itself it will output it in an error prompt and invalidate session
     * @param error Error
     */
    public handleAxiosError(error: any) {
        if (error.response) {
            if (error.response.status === 401 && !this.error401thrown) {
                vscode.window.showWarningMessage("It seems that we couldn't log in, please log in.");
                this.error401thrown = true;
                APIClientSession.invalidateSession();
                CoursesProvider.triggerTreeReload();
            } else if (error.response.status === 403 && !this.error403thrown) {
                vscode.window.showWarningMessage("Something went wrong, please try again.");
                this.error403thrown = true;
                this.getXSRFToken();
            } else {
                let msg = error.response.data;
                if (error.response.data instanceof Object) {
                    msg = JSON.stringify(error.response.data);
                }
                vscode.window.showErrorMessage("Error " + error.response.status + ". " + msg);
                this.error401thrown = false;
                this.error403thrown = false;
                APIClientSession.invalidateSession();
            }
        } else if (error.request) {
            vscode.window.showErrorMessage("Can't connect to the server. " + error.message);
            APIClientSession.invalidateSession();
        } else {
            vscode.window.showErrorMessage(error.message);
            APIClientSession.invalidateSession();
        }
    }

    /*
     * The following methods query the public API of the V4T backend (actions).
     * See specification at:
     * https://github.com/codeurjc-students/2019-VSCode4Teaching/blob/master/vscode4teaching-server/API.md
     */

    public getServerUserInfo(): AxiosPromise<User> {
        const options: AxiosBuildOptions = {
            url: "/api/currentuser",
            method: "GET",
            responseType: "json",
        };
        return this.createRequest(options, "Fetching user data...");
    }

    public getExercises(courseId: number): AxiosPromise<Exercise[]> {
        const options: AxiosBuildOptions = {
            url: "/api/courses/" + courseId + "/exercises",
            method: "GET",
            responseType: "json",
        };
        return this.createRequest(options, "Fetching exercises...");
    }

    public getExerciseFiles(exerciseId: number): AxiosPromise<ArrayBuffer> {
        const options: AxiosBuildOptions = {
            url: "/api/exercises/" + exerciseId + "/files",
            method: "GET",
            responseType: "arraybuffer",
        };
        return this.createRequest(options, "Downloading exercise files...");
    }

    public addCourse(data: CourseEdit): AxiosPromise<Course> {
        const options: AxiosBuildOptions = {
            url: "/api/courses",
            method: "POST",
            responseType: "json",
            data,
        };
        return this.createRequest(options, "Creating course...");
    }

    public editCourse(id: number, data: CourseEdit): AxiosPromise<Course> {
        const options: AxiosBuildOptions = {
            url: "/api/courses" + id,
            method: "PUT",
            responseType: "json",
            data,
        };
        return this.createRequest(options, "Editing course...");
    }

    public deleteCourse(id: number): AxiosPromise<void> {
        const options: AxiosBuildOptions = {
            url: "/api/courses" + id,
            method: "DELETE",
            responseType: "json",
        };
        return this.createRequest(options, "Deleting course...");
    }

    public addExercise(id: number, data: ExerciseEdit): AxiosPromise<Exercise> {
        const options: AxiosBuildOptions = {
            url: "/api/courses/" + id + "/exercises",
            method: "POST",
            responseType: "json",
            data,
        };
        return this.createRequest(options, "Adding exercise...");
    }

    public editExercise(id: number, data: ExerciseEdit): AxiosPromise<Exercise> {
        const options: AxiosBuildOptions = {
            url: "/api/exercises/" + id,
            method: "PUT",
            responseType: "json",
            data,
        };
        return this.createRequest(options, "Sending exercise info...");
    }

    public uploadExerciseTemplate(id: number, data: Buffer): AxiosPromise<any> {
        const dataForm = new FormData();
        dataForm.append("file", data, { filename: "template.zip" });
        const options: AxiosBuildOptions = {
            url: "/api/exercises/" + id + "/files/template",
            method: "POST",
            responseType: "json",
            data: dataForm,
        };
        return this.createRequest(options, "Uploading template...");
    }

    public deleteExercise(id: number): AxiosPromise<void> {
        const options: AxiosBuildOptions = {
            url: "/api/exercises/" + id,
            method: "DELETE",
            responseType: "json",
        };
        return this.createRequest(options, "Deleting exercise...");
    }

    public getAllUsers(): AxiosPromise<User[]> {
        const options: AxiosBuildOptions = {
            url: "/api/users",
            method: "GET",
            responseType: "json",
        };
        return this.createRequest(options, "Fetching user data...");
    }

    public getUsersInCourse(courseId: number): AxiosPromise<User[]> {
        const options: AxiosBuildOptions = {
            url: "/api/courses/" + courseId + "/users",
            method: "GET",
            responseType: "json",
        };
        return this.createRequest(options, "Fetching user data...");
    }

    public addUsersToCourse(courseId: number, data: ManageCourseUsers): AxiosPromise<Course> {
        const options: AxiosBuildOptions = {
            url: "/api/courses/" + courseId + "/users",
            method: "POST",
            responseType: "json",
            data,
        };
        return this.createRequest(options, "Adding users to course...");
    }

    public removeUsersFromCourse(courseId: number, data: ManageCourseUsers): AxiosPromise<Course> {
        const options: AxiosBuildOptions = {
            url: "/api/courses/" + courseId + "/users",
            method: "DELETE",
            responseType: "json",
            data,
        };
        return this.createRequest(options, "Removing users from course...");
    }

    public getCreator(courseId: number): AxiosPromise<User> {
        const options: AxiosBuildOptions = {
            url: "/api/courses/" + courseId + "/creator",
            method: "GET",
            responseType: "json",
        };
        return this.createRequest(options, "Uploading files...");
    }

    public uploadFiles(exerciseId: number, data: Buffer): AxiosPromise<any> {
        const dataForm = new FormData();
        dataForm.append("file", data, { filename: "template.zip" });
        const options: AxiosBuildOptions = {
            url: "/api/exercises/" + exerciseId + "/files",
            method: "POST",
            responseType: "json",
            data: dataForm,
        };
        return this.createRequest(options, "Uploading files...");
    }

    public getAllStudentFiles(exerciseId: number): AxiosPromise<ArrayBuffer> {
        const options: AxiosBuildOptions = {
            url: "/api/exercises/" + exerciseId + "/teachers/files",
            method: "GET",
            responseType: "arraybuffer",
        };
        return this.createRequest(options, "Downloading student files...");
    }

    public getTemplate(exerciseId: number): AxiosPromise<ArrayBuffer> {
        const options: AxiosBuildOptions = {
            url: "/api/exercises/" + exerciseId + "/files/template",
            method: "GET",
            responseType: "arraybuffer",
        };
        return this.createRequest(options, "Downloading exercise template...");
    }

    public getFilesInfo(username: string, exerciseId: number): AxiosPromise<FileInfo[]> {
        const options: AxiosBuildOptions = {
            url: "/api/users/" + username + "/exercises/" + exerciseId + "/files",
            method: "GET",
            responseType: "json",
        };
        return this.createRequest(options, "Fetching file information...");
    }

    public saveComment(fileId: number, commentThread: ServerCommentThread): AxiosPromise<ServerCommentThread> {
        const options: AxiosBuildOptions = {
            url: "/api/files/" + fileId + "/comments",
            method: "POST",
            responseType: "json",
            data: commentThread,
        };
        return this.createRequest(options, "Fetching comments...");
    }

    public getComments(fileId: number): AxiosPromise<ServerCommentThread[] | void> {
        const options: AxiosBuildOptions = {
            url: "/api/files/" + fileId + "/comments",
            method: "GET",
            responseType: "json",
        };
        return this.createRequest(options, "Fetching comments...");
    }

    public getAllComments(username: string, exerciseId: number): AxiosPromise<FileInfo[] | void> {
        const options: AxiosBuildOptions = {
            url: "/api/users/" + username + "/exercises/" + exerciseId + "/comments",
            method: "GET",
            responseType: "json",
        };
        return this.createRequest(options, "Fetching comments...");
    }

    public getSharingCode(element: Course | Exercise): AxiosPromise<string> {
        const typeOfUrl = instanceOfCourse(element) ? "courses/" : "exercises/";
        const options: AxiosBuildOptions = {
            url: "/api/" + typeOfUrl + element.id + "/code",
            method: "GET",
            responseType: "json",
        };
        return this.createRequest(options, "Fetching sharing code...");
    }

    public updateCommentThreadLine(id: number, line: number, lineText: string): AxiosPromise<ServerCommentThread> {
        const data = {
            line,
            lineText,
        };
        const options: AxiosBuildOptions = {
            url: "/api/comments/" + id + "/lines",
            method: "PUT",
            responseType: "json",
            data,
        };
        return this.createRequest(options, "Saving comments...");
    }

    public getCourseWithCode(code: string): AxiosPromise<Course> {
        const options: AxiosBuildOptions = {
            url: "/api/courses/code/" + code,
            method: "GET",
            responseType: "json",
        };
        return this.createRequest(options, "Fetching course data...");
    }

    private signUp(credentials: UserSignup): AxiosPromise<User> {
        const options: AxiosBuildOptions = {
            url: "/api/register",
            method: "POST",
            responseType: "json",
            data: credentials,
        };
        return this.createRequest(options, "Signing up to VS Code 4 Teaching...");
    }

    private signUpTeacher(credentials: UserSignup): AxiosPromise<User> {
        const options: AxiosBuildOptions = {
            url: "/api/teachers/register",
            method: "POST",
            responseType: "json",
            data: credentials,
        };
        return this.createRequest(options, "Signing teacher up to VS Code 4 Teaching...");
    }
    /**
     * Sets vscode status bar and returns axios promise for given options.
     * @param options Options from to build axios request
     * @param statusMessage message to add to the vscode status bar
     */
    private createRequest(options: AxiosBuildOptions, statusMessage: string): AxiosPromise<any> {
        const thenable = axios(APIClientSession.buildOptions(options));
        vscode.window.setStatusBarMessage(statusMessage, thenable);
        return thenable;
    }

    /**
     * Gets XSRF Token from server and sets session's xsrf token
     */
    private async getXSRFToken() {
        const options: AxiosBuildOptions = {
            url: "/api/csrf",
            method: "GET",
            responseType: "json",
        };
        const response = await this.createRequest(options, "Fetching server info...");
        const cookiesString: string | undefined = response.headers["set-cookie"][0];
        if (cookiesString) {
            const cookies = cookiesString.split(";");
            const xsrfCookie = cookies.find((cookie) => cookie.includes("XSRF-TOKEN"));
            if (xsrfCookie) {
                APIClientSession.xsrfToken = xsrfCookie.split("=")[1];
            } else {
                throw Error("XSRF Token not received");
            }
        } else {
            throw Error("XSRF Token not received");
        }
    }

    private login(username: string, password: string): AxiosPromise<{ jwtToken: string }> {
        const data = {
            username,
            password,
        };
        const options: AxiosBuildOptions = {
            url: "/api/login",
            method: "POST",
            responseType: "json",
            data,
        };
        return this.createRequest(options, "Logging in to VS Code 4 Teaching...");
    }
}
// API Client is a singleton
export let APIClient = new APIClientSingleton();