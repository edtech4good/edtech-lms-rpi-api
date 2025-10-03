import { SchoolRole } from "./enums/school.role.enum";

export interface Token {
  studentfirstname?: string;
  studentlastname?: string;
  studentid?: string;
  schooluserid?: string;
  schoolusername?: string;
  schooluserrole?: SchoolRole;
  city?: string;
  contact?: string;
  country?: string;
  dateofbirth?: string;
  dateofjoin?: string;
  fathername?: string;
  genderid?: number;
  mothername?: string;
  schoolname?: string;
  schooltype?: string;
  standard?: string;
  state?: string;
  startinglevelid?: string;
  studentcurrentlessonid?: string;
  studentcurrentlevelid?: string;
  baselineid?: string;
  baselinepassed?: boolean;
  profileimage?: string;
  familyname?: string;
  is_teacher_acc?: boolean;
  curriculumids?: Array<string>;
}
