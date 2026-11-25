"""HTTP validation and response contract for module invitation suggestions."""


def curriculum_module_meeting_invitees(request, module_catalogue_id, *, clean_str, json_error, JsonResponse, read_invitees):
    """Who to invite to this module's Teams meeting, derived rather than typed.

    Presenters: the module's own ``tutor_email`` (one tutor per module, stored
    alongside ``tutor_name`` by both write paths -- module save and the group
    staffing PATCH that fans a tutor out across its group's modules).

    Attendees: the learners whose own training plan carries this module, and
    nobody else. Deliberately *not* the module's Learners tab roster: that one
    starts from everyone enrolment placed in the group that delivers the module
    and then adjusts, so prefilling from it put a whole group on a Teams
    meeting the author had not invited them to. Being in the group is not an
    invitation; having the module on your plan is.

    ``learner_api.LearnerTrainingPlanModule.curriculum_module`` is the normalized
    assignment source. A learner named there is assigned; a learner absent
    there is not, however their group was placed.

    Still a starting point for the Attendees field, not a binding assignment --
    the author can edit freely before saving, and only what the form finally
    holds is ever sent to Microsoft.
    """
    module_catalogue_id = clean_str(module_catalogue_id)
    if not module_catalogue_id:
        return json_error('A module id is required.')
    return JsonResponse(read_invitees(module_catalogue_id))
